# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import model_dataset

APP = 'documents'
# The policy is an explicit allowlist: a new field is not exported until someone decides it belongs in the export.
POLICY_FIELDS = (
    'id',
    'company_id',
    'create_date',
    'write_date',
)
MANAGED = [('storage_id.liwan_documents_managed', '=', True)]
MANAGED_SCOPE = 'Only the libraries LiwanOS manages for its documents; other document storages are not exported.'
FILE_FIELDS = (
    'id', 'name', 'directory_id', 'active', 'extension', 'mimetype', 'size', 'checksum', 'locked_by', 'attachment_id',
    'create_date', 'write_date',
)
DIRECTORY_FIELDS = ('id', 'name', 'parent_id', 'res_model', 'res_id', 'create_date')


def _file_attachments(files):
    """The stored file of each managed document file: its attachment, when the content is a stored binary."""
    return [(file.id, file.attachment_id) for file in files if file.attachment_id and file.attachment_id.type == 'binary']


class LiwanDocumentsTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            model_dataset(self.env, APP, 'documents', 'Documents', 'liwan.document'),
            model_dataset(self.env, APP, 'document_grants', 'Document grants', 'liwan.document.grant'),
            model_dataset(self.env, APP, 'document_policy', 'Policy', 'liwan.document.policy', fields=POLICY_FIELDS),
            model_dataset(
                self.env, APP, 'document_directories', 'Directories', 'dms.directory', fields=DIRECTORY_FIELDS, domain=MANAGED,
                scope=MANAGED_SCOPE,
            ),
            model_dataset(
                self.env, APP, 'document_files', 'Files', 'dms.file', fields=FILE_FIELDS, domain=MANAGED,
                scope=MANAGED_SCOPE, attachments=_file_attachments,
            ),
        ]
