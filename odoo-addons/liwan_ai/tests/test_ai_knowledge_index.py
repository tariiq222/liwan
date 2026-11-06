# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_ai.models import knowledge_indexer
from odoo.addons.liwan_ai.models.knowledge_chunker import record_chunks
from odoo.addons.liwan_ai.models.knowledge_indexer import KNOWLEDGE_FEATURE
from odoo.addons.liwan_ai.tests.common import PROBE_SOURCE, AiProbe
from odoo.addons.liwan_api.tests.common import set_probe_feature

MODEL = 'res.partner'


@tagged('post_install', '-at_install', 'liwan')
class TestAiKnowledgeIndex(AiProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._install_knowledge()
        self.indexer = self.env['liwan.ai.knowledge.indexer']
        self.cursors = self.env['liwan.ai.knowledge.cursor']
        # Everything the database already holds is read once, so a test sees only its own records afterwards.
        self._tick()
        self._clear_queue()

    def _state(self):
        self.env.cr.execute('SELECT count(*) FROM liwan_ai.ai_knowledge_queue')
        return (self.env.cr.fetchone()[0], self.cursors.search([('model', '=', MODEL)]).mapped('last_id'),
                self.env['liwan.ai.knowledge.pending'].search_count([]))

    def _tick(self):
        """Run the cron until it has nothing more to queue."""
        for _ in range(30):
            before = self._state()
            self.indexer._liwan_cron_tick()
            if before == self._state():
                return

    def _mark(self, record, vals=None):
        """What the bridge of the source does after a write of ``vals`` (every field when none are given)."""
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_changed(record, vals)

    def _clear_queue(self):
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')

    def _partner(self, **values):
        return self.env['res.partner'].create({'name': 'Indexed', 'company_id': self.env.company.id, **values})

    def _upserts(self):
        return {row[2]: row for row in self._queue(MODEL) if row[0] == 'upsert'}

    def test_a_new_record_is_found_by_the_scan_with_its_chunks_and_company(self):
        partner = self._partner(name='Alpha', function='Engineer')
        self._tick()
        self.assertEqual(self._queue(MODEL), [('upsert', MODEL, partner.id, self.env.company.id, record_chunks(partner, PROBE_SOURCE))])
        self.assertIn('Alpha', self._queue(MODEL)[0][4][0])

    def test_a_marked_record_is_queued_again_and_an_unmarked_change_is_not(self):
        partner = self._partner()
        self._tick()
        self._clear_queue()
        partner.function = 'Manager'
        self._tick()
        self.assertEqual(self._queue(MODEL), [])
        self._mark(partner, {'function': 'Manager'})
        self._tick()
        self.assertEqual([(row[0], row[2]) for row in self._queue(MODEL)], [('upsert', partner.id)])
        self.assertFalse(self.env['liwan.ai.knowledge.pending'].search([]))

    def test_a_record_written_in_a_late_transaction_is_still_indexed(self):
        partner = self._partner()
        self._tick()
        self._clear_queue()
        # Its transaction began long before the scan passed it and commits only now: older write_date, row marked now.
        partner.function = 'Late'
        self.env.flush_all()
        self.env.cr.execute("UPDATE res_partner SET write_date = write_date - interval '1 day' WHERE id = %s", [partner.id])
        partner.invalidate_recordset()
        self._mark(partner)
        self._tick()
        self.assertIn('Late', ' '.join(self._upserts()[partner.id][4]))

    def test_the_bootstrap_scan_covers_the_records_that_exist_when_the_index_is_rebuilt(self):
        partners = self._partner() | self._partner() | self._partner()
        self._tick()
        self._clear_queue()
        self.assertTrue(self.indexer._liwan_rebuild())
        self._tick()
        self.assertTrue(set(partners.ids) <= set(self._upserts()))
        self.assertEqual(len([row for row in self._queue() if row[0] == 'reset']), 1)

    def test_an_archived_marked_record_is_queued_for_deletion(self):
        partner = self._partner()
        self._tick()
        self._clear_queue()
        partner.active = False
        self._mark(partner, {'active': False})
        self._tick()
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, partner.id, None, None)])

    def test_a_marked_record_that_no_longer_exists_is_queued_for_deletion(self):
        partner = self._partner()
        self._tick()
        self._clear_queue()
        self._mark(partner)
        partner_id = partner.id
        partner.unlink()
        self._tick()
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, partner_id, None, None)])

    def test_a_record_with_no_text_is_queued_for_deletion(self):
        partner = self._partner()
        self._tick()
        self._clear_queue()
        self.patch(knowledge_indexer, 'record_chunks', lambda record, source: [])
        self._mark(partner)
        self._tick()
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, partner.id, None, None)])

    def test_marking_follows_the_declared_fields_only(self):
        partner = self._partner()
        pending = self.env['liwan.ai.knowledge.pending']
        self._mark(partner, {'ref': 'x', 'color': 3})
        self.assertFalse(pending.search([]))
        for vals in ({'function': 'x'}, {'name': 'y'}, {'comment': 'z'}, {'active': False}, {'company_id': False}):
            with self.subTest(vals=vals):
                pending.search([]).unlink()
                self._mark(partner, vals)
                self.assertEqual(pending.search([]).mapped('res_id'), [partner.id])
        self._mark(partner)  # marking twice leaves one row
        self.assertEqual(pending.search_count([]), 1)

    def test_nothing_is_marked_while_the_setting_is_off(self):
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = False
        self._mark(self._partner())
        self.assertFalse(self.env['liwan.ai.knowledge.pending'].search([]))

    def test_a_batch_stops_at_its_size_and_the_next_run_resumes(self):
        self.patch(knowledge_indexer, 'BATCH_SIZE', 2)
        partners = self._partner() | self._partner() | self._partner()
        self.indexer._liwan_cron_tick()
        self.assertEqual(len(self._queue(MODEL)), 2)
        for partner in partners:
            self._mark(partner)
        self._tick()
        self.assertEqual(set(self._upserts()), set(partners.ids))

    def test_nothing_is_queued_without_an_acknowledgement(self):
        self.env['liwan.ai.consent']._liwan_valid_all().write({'revoked_at': '2026-01-01 00:00:00', 'revoked_by_id': self.env.uid})
        self._clear_queue()
        self._partner()
        self._tick()
        self.assertEqual(self._queue(MODEL), [])

    def test_nothing_is_queued_while_the_setting_is_off(self):
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = False
        self._clear_queue()
        self._partner()
        self._tick()
        self.assertEqual(self._queue(MODEL), [])

    def test_nothing_is_queued_while_the_feature_is_off(self):
        set_probe_feature(self, KNOWLEDGE_FEATURE, enabled=False)
        self._partner()
        self._tick()
        self.assertEqual(self._queue(MODEL), [])

    def test_a_source_whose_own_feature_is_off_is_skipped(self):
        self.patch(
            type(self.env['liwan.ai.knowledge.registry']), '_liwan_ai_knowledge_sources',
            lambda model: [{**PROBE_SOURCE, 'feature_key': 'ai.messages.monthly'}],
        )
        self._partner()
        self._tick()
        self.assertEqual(self._queue(MODEL), [])

    def test_nothing_happens_and_nothing_fails_without_the_queue_table(self):
        self.env.cr.execute('DROP SCHEMA liwan_ai CASCADE')
        cursor = self.cursors.search([('model', '=', MODEL)]).read(['last_id'])
        self._partner()
        self.indexer._liwan_cron_tick()
        self.assertFalse(self.indexer._liwan_queue_insertable())
        self.assertEqual(self.cursors.search([('model', '=', MODEL)]).read(['last_id']), cursor)
        self.assertFalse(self.indexer._liwan_rebuild())

    def test_forgetting_records_queues_their_deletion(self):
        partners = self._partner() | self._partner()
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_forget(partners)
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, partner_id, None, None) for partner_id in partners.ids])

    def test_forgetting_a_model_that_is_no_source_queues_nothing(self):
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_forget(self.env['res.country'].search([], limit=2))
        self.assertEqual(self._queue(), [])

    def test_forgetting_without_the_queue_table_is_harmless(self):
        self.env.cr.execute('DROP SCHEMA liwan_ai CASCADE')
        self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_forget(self._partner())

    def test_a_rebuild_clears_the_cursors_and_queues_one_reset(self):
        self._partner()
        self._tick()
        self.assertTrue(self.cursors.search([('model', '=', MODEL)]))
        self._clear_queue()
        self.assertTrue(self.indexer._liwan_rebuild())
        self.assertFalse(self.cursors.search([]))
        self.assertEqual(self._queue(), [('reset', None, None, None, None)])
        # The sources are read from the start again.
        self._tick()
        self.assertGreater(len([row for row in self._queue(MODEL) if row[0] == 'upsert']), 0)

    def test_a_record_that_cannot_be_chunked_is_skipped_and_not_retried(self):
        poison = self._partner(name='Poison text')
        good = self._partner(name='Good')
        self._mark(poison)
        self._mark(good)
        original = knowledge_indexer.record_chunks

        def chunks(record, source):
            if record == poison:
                msg = 'boom with the record text'
                raise ValueError(msg)
            return original(record, source)

        self.patch(knowledge_indexer, 'record_chunks', chunks)
        with self.assertLogs('odoo.addons.liwan_ai.models.knowledge_indexer', 'WARNING') as logged:
            self._tick()
        self.assertEqual([row[2] for row in self._queue(MODEL) if row[0] == 'upsert'], [good.id])
        message = logged.output[0]
        self.assertIn(f'{MODEL},{poison.id}', message)
        self.assertNotIn('Poison text', message)
        self.assertNotIn('boom', message)
        self.assertFalse(self.env['liwan.ai.knowledge.pending'].search([]))
        self._clear_queue()
        self._tick()
        self.assertEqual(self._queue(MODEL), [])

    def test_a_failed_queue_insert_of_one_record_does_not_lose_the_others(self):
        bad = self._partner(name='Bad')
        good = self._partner(name='Fine')
        original = self.indexer._liwan_queue_upsert

        def upsert(model, record_id, company_id, chunks):
            if record_id == bad.id:
                self.env.cr.execute('SELECT 1/0')
            return original(model, record_id, company_id, chunks)

        self.patch(type(self.indexer), '_liwan_queue_upsert', lambda model, *args: upsert(*args))
        with self.assertLogs('odoo.addons.liwan_ai.models.knowledge_indexer', 'WARNING'):
            self._tick()
        self.assertEqual([row[2] for row in self._queue(MODEL) if row[0] == 'upsert'], [good.id])

    def test_turning_the_setting_off_drops_the_index_with_one_reset(self):
        self._partner()
        self._tick()
        self._clear_queue()
        settings = self.env['liwan.ai.settings']._liwan_current()
        self._mark(self._partner())
        settings.knowledge_enabled = False
        self.assertEqual(self._queue(), [('reset', None, None, None, None)])
        self.assertFalse(self.cursors.search([]))
        self.assertFalse(self.env['liwan.ai.knowledge.pending'].search([]))
        settings.knowledge_enabled = False  # no change, no second reset
        settings.write({'messages_per_user_monthly': 5})
        self.assertEqual(len(self._queue()), 1)
        settings.knowledge_enabled = True  # turning it on drops nothing
        self.assertEqual(len(self._queue()), 1)

    def test_revoking_the_acknowledgement_drops_the_index_with_one_reset(self):
        self._partner()
        self._tick()
        self._clear_queue()
        self.env['liwan.ai.consent']._liwan_valid_all().write({'revoked_at': '2026-01-01 00:00:00', 'revoked_by_id': self.env.uid})
        self.assertEqual(self._queue(), [('reset', None, None, None, None)])
        self.assertFalse(self.cursors.search([]))

    def test_turning_it_off_or_revoking_without_the_queue_table_is_harmless(self):
        self.env.cr.execute('DROP SCHEMA liwan_ai CASCADE')
        self.env['liwan.ai.settings']._liwan_current().knowledge_enabled = False
        self.env['liwan.ai.consent']._liwan_valid_all().write({'revoked_at': '2026-01-01 00:00:00', 'revoked_by_id': self.env.uid})

    def test_a_new_company_joins_the_indexer(self):
        indexer = self.env.ref('liwan_ai.user_ai_indexer')
        company = self.env['res.company'].create({'name': 'Indexed branch'})
        self.assertIn(company, indexer.company_ids)
        self.assertEqual(set(self.env['res.company'].with_context(active_test=False).search([]).ids), set(indexer.company_ids.ids))

    def test_the_indexer_holds_the_capabilities_the_sources_declare_in_every_company(self):
        indexer = self.env.ref('liwan_ai.user_ai_indexer')
        company = self.env['res.company'].create({'name': 'Indexer capability company'})
        service = self.env['liwan.access.service']
        for each in (self.env.company, company):
            self.assertIn('ai.use', service.with_user(indexer)._liwan_capability_keys(indexer, company=each))
        self.assertFalse(self.env['liwan.access.assignment'].search([('user_id', '=', indexer.id)]))
        self.patch(type(self.env['liwan.ai.knowledge.registry']), '_liwan_ai_knowledge_sources', lambda model: [])
        self.env.registry.clear_cache()
        service._liwan_clear_branch_cache()
        self.assertNotIn('ai.use', service.with_user(indexer)._liwan_capability_keys(indexer, company=company))

    def test_the_indexer_is_an_inactive_technical_user_in_its_own_group_only(self):
        indexer = self.env.ref('liwan_ai.user_ai_indexer')
        self.assertFalse(indexer.active)
        self.assertEqual(indexer.group_ids, self.env.ref('liwan_ai.group_ai_indexer'))
        cron = self.env.ref('liwan_ai.ir_cron_ai_knowledge')
        self.assertEqual((cron.user_id, cron.interval_number, cron.interval_type), (indexer, 5, 'minutes'))
