# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

from odoo.addons.liwan_ai.models.tool_registry import SENSITIVE_FIELDS

KNOWLEDGE_FIELD_TYPES = ('char', 'text', 'html', 'selection', 'many2one')
KNOWLEDGE_TEXT = ('model', 'owner', 'feature_key', 'title_field', 'label_ar', 'label_en')
INDEXER_USER = 'liwan_ai.user_ai_indexer'
CAPABILITY_KEY = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')


class LiwanAiKnowledgeRegistry(models.AbstractModel):
    """The record models the assistant may search (spec 2026-11-04 §6.3, §6.6), composed through ``super()``.

    Each application declares, in its ``liwan_<app>_ai`` bridge, the models of its own it lets the AI index, the text
    fields that make up a record's knowledge text, and the capabilities of its own (``indexer_capabilities``) that its
    record rules and routes ask of a reader. A declaration is data only: it never names a sensitive field (the platform
    constant and the owner's agent declaration), liwan_ai names no application capability itself, and the bridge grants
    the technical indexer user read access to the model.
    """
    _name = 'liwan.ai.knowledge.registry'
    _description = 'LiwanOS AI knowledge registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_knowledge_sources(self):
        """Pure descriptors; never a process-global set."""
        return []

    def _liwan_ai_error(self, model, message):
        raise ValidationError(self.env._('liwan_ai: knowledge source %(model)s: %(message)s', model=model, message=message))

    @api.model
    def _liwan_ai_knowledge_validate(self, item):
        model_name = item.get('model')
        for name in KNOWLEDGE_TEXT:
            if not item.get(name) or not isinstance(item[name], str):
                self._liwan_ai_error(repr(model_name), f'missing {name}')
        model = self.env.get(model_name)
        if model is None:
            self._liwan_ai_error(model_name, 'the model does not exist')
        if not isinstance(item.get('fields'), (list, tuple)) or not item['fields']:
            self._liwan_ai_error(model_name, 'fields must be a non-empty list')
        capabilities = item.get('indexer_capabilities')
        # Only well-formed here: a source names what its application asks of a reader, and a capability of an application
        # that is not installed (a bridge installed without liwan_pmo) is simply not registered and not held.
        if (not isinstance(capabilities, (list, tuple)) or not capabilities
                or not all(isinstance(key, str) and CAPABILITY_KEY.match(key) for key in capabilities)):
            self._liwan_ai_error(model_name, 'indexer_capabilities must be a list of capability keys')
        agent = self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().get(item['owner'].removeprefix('liwan_'), {})
        sensitive = SENSITIVE_FIELDS | set(agent.get('sensitive_fields', ()))
        for name in (item['title_field'], *item['fields']):
            field = model._fields.get(name)
            if field is None or field.type not in KNOWLEDGE_FIELD_TYPES:
                self._liwan_ai_error(model_name, f'{name} is not a field of type {KNOWLEDGE_FIELD_TYPES}')
            if name in sensitive:
                self._liwan_ai_error(model_name, f'{name} is a sensitive field')
        company = model._fields.get('company_id')
        if company is None or company.type != 'many2one' or company.comodel_name != 'res.company':
            self._liwan_ai_error(model_name, 'the model must have a company_id')

    @api.model
    def _liwan_ai_knowledge_map(self):
        sources = {}
        for item in self._liwan_ai_knowledge_sources():
            self._liwan_ai_knowledge_validate(item)
            if item['model'] in sources:
                self._liwan_ai_error(item['model'], 'duplicate source')
            sources[item['model']] = item
        return sources

    @api.model
    def _liwan_ai_indexer_capabilities(self):
        """The capabilities the technical indexer user holds in every company: those the declared sources ask of a reader
        and that are registered in this database."""
        known = self.env['liwan.access.service']._liwan_capability_map()
        return {key for item in self._liwan_ai_knowledge_sources() for key in item.get('indexer_capabilities', ()) if key in known}

    @api.model
    def _liwan_ai_knowledge_changed(self, records, vals=None):
        """Mark ``records`` as changed for the indexer (a bridge calls it after it creates or writes them).

        A write (``vals``) that touches none of the source's text fields, nor ``active`` or ``company_id``, changes
        nothing the index holds and marks nothing.
        """
        source = next((item for item in self._liwan_ai_knowledge_sources() if item['model'] == records._name), None)
        if source and (vals is None or {*source['fields'], source['title_field'], 'active', 'company_id'} & set(vals)):
            self.env['liwan.ai.knowledge.pending']._liwan_mark(records)

    @api.model
    def _liwan_ai_knowledge_forget(self, records):
        """Tell the index to drop ``records`` (a bridge calls it before it deletes them); a no-op while no queue exists."""
        if records and any(item['model'] == records._name for item in self._liwan_ai_knowledge_sources()):
            self.env['liwan.ai.knowledge.indexer']._liwan_queue_delete(records._name, records.ids)
