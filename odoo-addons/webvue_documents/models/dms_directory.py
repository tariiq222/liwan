# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .dms_policy import (
    directory_allows,
    directory_document,
    managed_directory,
    require_directory,
    require_resource_mutation,
)


class DmsDirectory(models.Model):
    _inherit = 'dms.directory'

    webvue_canonical_document_ids = fields.One2many(
        'webvue.document', 'directory_id', readonly=True,
    )

    def filtered_domain(self, domain):
        # OCA returns every record in an elevated filtered_domain call. Core uses
        # exactly that call to check rules on a warm cache. Filter only our linked
        # resources using the actual actor; leave non-managed DMS behavior intact.
        return super().filtered_domain(domain).filtered(directory_allows)

    def read(self, fields=None, load='_classic_read'):
        for directory in self:
            require_directory(directory)
        return super().read(fields, load=load)

    def copy_data(self, default=None):
        for directory in self:
            require_directory(directory)
        return super().copy_data(default)

    @api.model_create_multi
    def create(self, values):
        if not self.env.user._is_superuser():
            for item in values:
                parent_id = item.get(
                    'parent_id', self.env.context.get('default_parent_id'),
                )
                parent = self.browse(parent_id).exists() if parent_id else self.browse()
                owned = item.get('res_model', self.env.context.get('default_res_model')) == 'webvue.document' or (
                    parent and managed_directory(parent)
                )
                storage_id = item.get('storage_id', self.env.context.get('default_storage_id'))
                if storage_id:
                    owned = (
                        owned
                        or self.env['dms.storage']
                        .browse(storage_id)
                        .webvue_documents_managed
                    )
                if owned:
                    document_id = item.get('res_id')
                    require_resource_mutation(self.env, document_id, {'create'})
                    if (
                        item.get('res_model') != 'webvue.document'
                        or not parent
                        or not parent.is_root_directory
                        or item.get('is_root_directory')
                        or item.get('group_ids')
                    ):
                        msg = 'document directories are structural'
                        raise AccessError(msg)
                    self.env['webvue.document'].browse(document_id)._webvue_require(
                        'write',
                    )
        return super().create(values)

    def write(self, values):
        if not self.env.user._is_superuser():
            target_parent = self.browse(values.get('parent_id')).exists() if values.get('parent_id') else self.browse()
            target_storage = self.env['dms.storage'].browse(values.get('storage_id')).exists() if values.get('storage_id') else self.env['dms.storage'].browse()
            if (values.get('res_model') == 'webvue.document'
                    or (target_parent and managed_directory(target_parent))
                    or (target_storage and target_storage.webvue_documents_managed)):
                msg = 'unmanaged directories cannot enter managed document scope'
                raise AccessError(msg)
            for directory in self:
                if managed_directory(directory):
                    document = directory_document(directory)
                    require_resource_mutation(
                        self.env, document.id, {'write', 'create'},
                    )
                    if set(values) - {'tag_ids'}:
                        msg = 'document directories are structural'
                        raise AccessError(msg)
                    tags = self.env['dms.tag'].browse()
                    for command in values.get('tag_ids', []):
                        if command[0] == 6:
                            tags |= self.env['dms.tag'].browse(command[2])
                        elif command[0] == 4:
                            tags |= self.env['dms.tag'].browse(command[1])
                        elif command[0] not in (3, 5):
                            msg = 'document tags must reference existing company tags'
                            raise AccessError(
                                msg,
                            )
                    tags.check_access('read')
                    if any(tag.company_id != self.env.company for tag in tags):
                        msg = 'document tag belongs to another company'
                        raise AccessError(msg)
        return super().write(values)

    def unlink(self):
        if not self.env.user._is_superuser() and any(
            managed_directory(item) for item in self
        ):
            msg = 'document directories cannot be deleted'
            raise AccessError(msg)
        return super().unlink()
