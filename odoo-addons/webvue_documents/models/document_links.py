# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule


class DocumentLinks(models.AbstractModel):
    _name = 'webvue.document.links'
    _description = 'Document application links'
    _webvue_scope = 'global'

    @api.model
    def _webvue_context_definitions(self):
        return ()

    @api.model
    def _webvue_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
        msg = 'invalid'
        raise WebVueAccessRule(msg, 'unknown document context', field='context')

    @api.model
    def _webvue_prepare_context(self, context):
        if context is not None:
            msg = 'invalid'
            raise WebVueAccessRule(
                msg, 'unknown document context', field='context',
            )
        return {}

    @api.model
    def _webvue_dump_context(self, document):
        document.ensure_one()
        return self._webvue_dump_contexts(document)[document.id]

    @api.model
    def _webvue_dump_contexts(self, documents):
        documents._webvue_require('read')
        return {document.id: None for document in documents}

    @api.model
    def _webvue_context_domain(self, kind, context_id):
        descriptor = next(
            (
                item
                for item in self._webvue_context_definitions()
                if item['kind'] == kind
            ),
            None,
        )
        if (
            not descriptor
            or descriptor.get('field')
            not in self.env['webvue.document']._webvue_context_fields()
        ):
            msg = 'invalid'
            raise WebVueAccessRule(
                msg, 'unknown document context', field='context',
            )
        return [(descriptor['field'], '=', context_id)]
