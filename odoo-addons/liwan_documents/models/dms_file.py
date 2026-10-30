# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

from .dms_policy import (
    directory_document,
    file_allows,
    file_document,
    managed_directory,
    require_file,
    require_resource_mutation,
)


class DmsFile(models.Model):
    _inherit = 'dms.file'

    def filtered_domain(self, domain):
        return super().filtered_domain(domain).filtered(file_allows)

    def read(self, fields=None, load='_classic_read'):
        for file in self:
            require_file(file)
        return super().read(fields, load=load)

    def copy_data(self, default=None):
        for file in self:
            require_file(file)
        return super().copy_data(default)

    @api.constrains('directory_id', 'attachment_id')
    def _liwan_check_canonical_attachment(self):
        for file in self:
            if not managed_directory(file.directory_id):
                continue
            document = directory_document(file.directory_id)
            attachment = file.attachment_id
            if (not document or file.directory_id != document.directory_id
                    or not attachment or attachment.res_model != 'liwan.document'
                    or attachment.res_id != document.id):
                msg = 'managed files require their canonical document attachment'
                raise AccessError(msg)
            if self.with_context(active_test=False).search_count([
                ('id', '!=', file.id), ('attachment_id', '=', attachment.id),
                ('directory_id.storage_id.liwan_documents_managed', '=', True),
            ]):
                msg = 'a document attachment has only one canonical file'
                raise AccessError(msg)

    @api.model_create_multi
    def create(self, values):
        if not self.env.user._is_superuser():
            for item in values:
                directory_id = (
                    item.get('directory_id')
                    or self.env.context.get('default_directory_id')
                    or self.env.context.get('active_id')
                )
                directory = (
                    self.env['dms.directory'].browse(directory_id).exists()
                    if directory_id
                    else self.env['dms.directory'].browse()
                )
                document = (
                    directory_document(directory)
                    if directory
                    else self.env['liwan.document'].browse()
                )
                attachment_id = item.get('attachment_id') or self.env.context.get(
                    'default_attachment_id',
                )
                if attachment_id:
                    attachment = self.env['ir.attachment'].browse(attachment_id)
                    if attachment.res_model == 'liwan.document':
                        if not document or attachment.res_id != document.id:
                            msg = 'document attachments cannot be aliased into another directory'
                            raise AccessError(
                                msg,
                            )
                if directory and managed_directory(directory):
                    require_resource_mutation(self.env, document.id, {'write'})
                    document._liwan_require('write')
                    if directory != document.directory_id or item.get('access_token'):
                        msg = 'document file linkage is immutable'
                        raise AccessError(msg)
        records = super().create(values)
        for file in records:
            if managed_directory(file.directory_id) and file.attachment_id:
                # Attachment mode removes content before the vendor inverse runs,
                # leaving its stored size/checksum empty. Fill existing DMS metadata
                # from the same canonical attachment; never copy its bytes.
                super(DmsFile, file).write(
                    {
                        'size': file.attachment_id.file_size,
                        'checksum': file.attachment_id.checksum,
                    },
                )
        return records

    def write(self, values):
        if not self.env.user._is_superuser():
            target = self.env['dms.directory'].browse(values.get('directory_id')).exists() if values.get('directory_id') else self.env['dms.directory'].browse()
            attachment = self.env['ir.attachment'].browse(values.get('attachment_id')).exists() if values.get('attachment_id') else self.env['ir.attachment'].browse()
            if ((target and managed_directory(target))
                    or (attachment and attachment.res_model == 'liwan.document')):
                msg = 'unmanaged files cannot enter managed document scope'
                raise AccessError(msg)
            for file in self:
                if managed_directory(file.directory_id):
                    document = file_document(file)
                    if 'active' in values and set(values) <= {'active', 'locked_by'}:
                        require_resource_mutation(self.env, document.id, {'archive'})
                    elif set(values) <= {'locked_by'}:
                        require_resource_mutation(self.env, document.id, {'write'})
                    else:
                        msg = 'document file changes require a protected operation'
                        raise AccessError(
                            msg,
                        )
        return super().write(values)

    def unlink(self):
        if not self.env.user._is_superuser() and any(
            managed_directory(file.directory_id) for file in self
        ):
            msg = 'document files cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()
