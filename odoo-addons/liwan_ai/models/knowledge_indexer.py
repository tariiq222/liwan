# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The indexing side of the knowledge retrieval (spec 2026-11-04 §6.3).

Odoo cannot reach the AI service, so the indexer appends events to ``liwan_ai.ai_knowledge_queue``, a table of the AI
schema (not an Odoo table, so R9's direct-SQL rule does not apply) that the service owns and drains: the database role
of Odoo may only insert into it. A record's text is chunked and withheld here (``knowledge_chunker``) and travels in
the queue until the service has embedded it; the index itself keeps vectors and references only.

What to index comes from two places. The bridge of a source marks a record in ``liwan.ai.knowledge.pending`` in the
transaction that changes it, and the cron claims those rows; and a bootstrap scan, in id order with a cursor per source
and company, reads the records that exist when the knowledge is turned on or the index rebuilt.
"""
import json
import logging

from odoo import Command, api, models

from odoo.addons.liwan_ai.models.knowledge_chunker import record_chunks

_logger = logging.getLogger(__name__)
QUEUE = 'liwan_ai.ai_knowledge_queue'
KNOWLEDGE_FEATURE = 'ai.knowledge'
BATCH_SIZE = 200
INSERT = f'INSERT INTO {QUEUE} (kind, model, res_id, company_id, chunks)'


class LiwanAiKnowledgeIndexer(models.AbstractModel):
    _name = 'liwan.ai.knowledge.indexer'
    _description = 'LiwanOS AI knowledge indexer'
    _liwan_scope = 'global'

    @api.model
    def _liwan_sync_companies(self):
        """Make each technical account (the indexer, the usage recorder) a member of every company, archived ones included.

        The indexer then reads each company's records and the recorder can record a row for a user of any company.
        """
        companies = self.env['res.company'].with_context(active_test=False).search([])
        for xmlid in ('liwan_ai.user_ai_indexer', 'liwan_ai.user_ai_usage'):
            account = self.env.ref(xmlid, raise_if_not_found=False)
            if account:
                account.write({'company_ids': [Command.link(company_id) for company_id in companies.ids]})

    @api.model
    def _liwan_queue_insertable(self):
        """Whether the queue exists and this database role may insert into it (no AI service or no grant: nothing is queued)."""
        self.env.cr.execute(
            # CASE, not AND: the privilege check of a missing table would raise instead of answering false.
            "SELECT to_regclass(%s) IS NOT NULL, CASE WHEN to_regclass(%s) IS NULL THEN false"
            " ELSE has_table_privilege(%s, 'INSERT') END", [QUEUE, QUEUE, QUEUE],
        )
        exists, allowed = self.env.cr.fetchone()
        if exists and not allowed:
            _logger.warning('liwan_ai: cannot queue knowledge events: no INSERT on %s for this role', QUEUE)
        return allowed

    @api.model
    def _liwan_queue_upsert(self, model, record_id, company_id, chunks):
        self.env.cr.execute(f'{INSERT} VALUES (%s, %s, %s, %s, %s::jsonb)', ['upsert', model, record_id, company_id, json.dumps(chunks)])

    @api.model
    def _liwan_queue_delete(self, model, record_ids):
        """Queue the removal of ``record_ids`` of ``model``; used by the indexer and by a bridge before it deletes records."""
        if record_ids and self._liwan_queue_insertable():
            self.env.cr.execute(f"{INSERT} SELECT 'delete', %s, id, NULL, NULL FROM unnest(%s::bigint[]) AS id", [model, list(record_ids)])

    @api.model
    def _liwan_queue_reset(self):
        self.env.cr.execute(f"{INSERT} VALUES ('reset', NULL, NULL, NULL, NULL)")

    @api.model
    def _liwan_rebuild(self):
        """Drop the whole index and read every source again: clear the cursors and the pending rows, and queue one reset."""
        if not self._liwan_queue_insertable():
            return False
        self.env['liwan.ai.knowledge.cursor'].search([]).unlink()
        self.env['liwan.ai.knowledge.pending'].search([]).unlink()
        self._liwan_queue_reset()
        return True

    @api.model
    def _liwan_indexing_enabled(self):
        """The queue takes events, the tenant signed the AI acknowledgement and turned knowledge on, and its package includes it."""
        return bool(
            self._liwan_queue_insertable()
            and self.env['liwan.ai.consent']._liwan_valid()
            and self.env['liwan.ai.settings']._liwan_current().knowledge_enabled
            and self.env['liwan.entitlement.service']._liwan_feature_read(KNOWLEDGE_FEATURE),
        )

    @api.model
    def _liwan_cron_tick(self):
        """Queue the next batch of every enabled source (cron, as the technical user ``liwan_ai.user_ai_indexer``)."""
        if not self._liwan_indexing_enabled():
            return
        entitlement = self.env['liwan.entitlement.service']
        for source in self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_map().values():
            if entitlement._liwan_feature_read(source['feature_key']):
                self._liwan_scan_source(source, handled=self._liwan_index_pending(source))

    @api.model
    def _liwan_index_pending(self, source):
        """Claim up to one batch of the records of ``source`` that changed and queue their current state.

        The rows are deleted before the records are read, in this transaction: a writer that commits after the read
        finds no row and inserts a new one, so no change is lost; a failed run rolls the claim back.
        """
        model = source['model']
        rows = self.env['liwan.ai.knowledge.pending'].search([('model', '=', model)], limit=BATCH_SIZE)
        by_company = {}
        for row in rows:
            by_company.setdefault(row.source_company_id, []).append(row.res_id)
        rows.unlink()
        handled = {(model, res_id) for ids in by_company.values() for res_id in ids}
        companies = self.env.user.company_ids
        for company, ids in by_company.items():
            if company in companies:
                Model = self.env[model].with_company(company).with_context(active_test=False)
                self._liwan_index_records(source, Model.search([('id', 'in', ids)]), ids)
            else:
                # A record of no company (or of one the indexer is not in) is never readable in a company.
                self._liwan_queue_delete(model, ids)
        return handled

    @api.model
    def _liwan_scan_source(self, source, handled=frozenset()):
        """The bootstrap: queue up to one batch of the existing records of ``source``, per company, in id order.

        ``handled`` are the records this run already queued from their pending rows; the scan passes over them."""
        model = source['model']
        cursors = self.env['liwan.ai.knowledge.cursor']
        for company in self.env.user.company_ids:
            Model = self.env[model].with_company(company).with_context(active_test=False)
            records = Model.search([('id', '>', cursors._liwan_last_id(model, company))], order='id', limit=BATCH_SIZE)
            if records:
                fresh = records.filtered(lambda record: (model, record.id) not in handled)
                self._liwan_index_records(source, fresh, fresh.ids)
                cursors._liwan_advance(model, company, records[-1].id)

    @api.model
    def _liwan_index_records(self, source, records, ids):
        """Queue the current state of the records ``ids`` of ``source``, ``records`` being those of them the indexer reads
        in the company: an upsert for each active one, a deletion for every other (archived, deleted, or hidden)."""
        model = source['model']
        archived = records.filtered(lambda record: 'active' in record._fields and not record.active)
        self._liwan_queue_delete(model, sorted((set(ids) - set(records.ids)) | set(archived.ids)))
        for record in records - archived:
            self._liwan_queue_record(model, record, source)

    @api.model
    def _liwan_queue_record(self, model, record, source):
        """Queue one record's chunks; a record that cannot be chunked or queued is logged by model and id, never by text, and skipped."""
        try:
            with self.env.cr.savepoint():
                chunks = record_chunks(record, source)
                # A record of no company is never readable in a company, so it is not indexed.
                if chunks and record.company_id:
                    self._liwan_queue_upsert(model, record.id, record.company_id.id, chunks)
                else:
                    self._liwan_queue_delete(model, record.ids)
        except Exception as error:  # noqa: BLE001 - one poison record must not stop the batch; the batch moves past it
            _logger.warning('liwan_ai: knowledge record %s,%s skipped (%s)', model, record.id, type(error).__name__)
