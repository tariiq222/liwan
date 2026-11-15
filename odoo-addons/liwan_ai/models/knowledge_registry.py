# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

INDEXER_USER = 'liwan_ai.user_ai_indexer'


class LiwanAiKnowledgeRegistry(models.AbstractModel):
    """What liwan_ai adds to the knowledge registry of liwan_api: the indexer's capabilities and the change hooks that
    feed its queue."""
    _inherit = 'liwan.ai.knowledge.registry'

    @api.model
    def _liwan_ai_indexer_capabilities(self):
        """The capabilities the technical indexer user holds in every company: those the declared sources ask of a reader
        and that are registered in this database."""
        known = self.env['liwan.access.service']._liwan_capability_map()
        return {key for item in self._liwan_ai_knowledge_sources() for key in item.get('indexer_capabilities', ()) if key in known}

    @api.model
    def _liwan_ai_knowledge_changed(self, records, vals=None):
        """Mark ``records`` as changed for the indexer.

        A write (``vals``) that touches none of the source's text fields, nor ``active`` or ``company_id``, changes
        nothing the index holds and marks nothing.
        """
        source = next((item for item in self._liwan_ai_knowledge_sources() if item['model'] == records._name), None)
        if source and (vals is None or {*source['fields'], source['title_field'], 'active', 'company_id'} & set(vals)):
            self.env['liwan.ai.knowledge.pending']._liwan_mark(records)

    @api.model
    def _liwan_ai_knowledge_forget(self, records):
        """Tell the index to drop ``records``; a no-op while no queue exists."""
        if records and any(item['model'] == records._name for item in self._liwan_ai_knowledge_sources()):
            self.env['liwan.ai.knowledge.indexer']._liwan_queue_delete(records._name, records.ids)
