# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .dms_policy import require_file, require_resource_mutation


class IrAttachment(models.Model):
    _inherit = 'ir.attachment'

    webvue_document_file_ids = fields.One2many(
        'dms.file', 'attachment_id', readonly=True,
    )

    def _webvue_document(self):
        self.ensure_one()
        if self.res_model == 'webvue.document' and self.res_id:
            return self.env['webvue.document'].browse(self.res_id)
        return self.env['webvue.document'].browse()

    @api.model_create_multi
    def create(self, values):
        if not self.env.user._is_superuser():
            for item in values:
                model = item.get('res_model', self.env.context.get('default_res_model'))
                if model == 'webvue.document':
                    document_id = item.get(
                        'res_id', self.env.context.get('default_res_id'),
                    )
                    require_resource_mutation(self.env, document_id, {'write'})
                    self.env['webvue.document'].browse(document_id)._webvue_require(
                        'write',
                    )
                    if (
                        item.get('public')
                        or item.get('access_token')
                        or item.get('type', 'binary') != 'binary'
                    ):
                        msg = 'document attachments are private binaries'
                        raise AccessError(msg)
        return super().create(values)

    def _webvue_require_document_file(self):
        self.ensure_one()
        document = self._webvue_document()
        if not document:
            return self.env['dms.file'].browse()
        document._webvue_require('read')
        file = self.env['dms.file'].with_context(active_test=False).search(
            [('attachment_id', '=', self.id),
             ('directory_id', '=', document.directory_id.id)], limit=1,
        )
        if not file:
            msg = 'document attachment has no accessible canonical file'
            raise AccessError(msg)
        require_file(file)
        return file

    def _webvue_require_attachment_read(self):
        if not self.env.user._is_superuser():
            for attachment in self:
                attachment._webvue_require_document_file()

    def read(self, fields=None, load='_classic_read'):
        self._webvue_require_attachment_read()
        return super().read(fields, load=load)

    def copy_data(self, default=None):
        self._webvue_require_attachment_read()
        return super().copy_data(default)

    def export_data(self, fields_to_export):
        self._webvue_require_attachment_read()
        return super().export_data(fields_to_export)

    def write(self, values):
        if not self.env.user._is_superuser():
            for attachment in self:
                document = attachment._webvue_document()
                if document or values.get('res_model') == 'webvue.document':
                    if not document:
                        msg = 'attachments cannot be reparented into documents'
                        raise AccessError(
                            msg,
                        )
                    require_resource_mutation(self.env, document.id, {'write'})
                    if set(values) - {'mimetype'}:
                        msg = 'document attachment identity and content are immutable'
                        raise AccessError(
                            msg,
                        )
        return super().write(values)

    def unlink(self):
        if not self.env.user._is_superuser() and any(
            item._webvue_document() for item in self
        ):
            msg = 'document attachments cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()
