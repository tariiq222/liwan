# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


class DocumentLinks(models.AbstractModel):
    _name = 'liwan.document.links'
    _description = 'Document application links'
    _liwan_scope = 'global'

    @api.model
    def _liwan_context_definitions(self):
        return ()

    @api.model
    def _liwan_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
        msg = 'invalid'
        raise LiwanAccessRule(msg, 'unknown document context', field='context')

    @api.model
    def _liwan_prepare_context(self, context):
        if context is not None:
            msg = 'invalid'
            raise LiwanAccessRule(
                msg, 'unknown document context', field='context',
            )
        return {}

    @api.model
    def _liwan_dump_context(self, document):
        document.ensure_one()
        return self._liwan_dump_contexts(document)[document.id]

    @api.model
    def _liwan_dump_contexts(self, documents):
        documents._liwan_require('read')
        return {document.id: None for document in documents}

    @api.model
    def _liwan_context_domain(self, kind, context_id):
        descriptor = next(
            (
                item
                for item in self._liwan_context_definitions()
                if item['kind'] == kind
            ),
            None,
        )
        if (
            not descriptor
            or descriptor.get('field')
            not in self.env['liwan.document']._liwan_context_fields()
        ):
            msg = 'invalid'
            raise LiwanAccessRule(
                msg, 'unknown document context', field='context',
            )
        return [(descriptor['field'], '=', context_id)]
