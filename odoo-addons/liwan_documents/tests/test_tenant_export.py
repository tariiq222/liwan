# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from .tenant_export_columns import COLUMNS
from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_columns_pinned,
    assert_contribution,
    datasets_by_key,
)

KEYS = ('documents', 'document_grants', 'document_policy', 'document_directories', 'document_files')


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentsTenantExport(TransactionCase):

    def test_the_metadata_reads_and_the_stored_files_are_attached_to_the_file_rows(self):
        assert_contribution(self, KEYS, {'document_files': ('id', 'name', 'directory_id', 'mimetype', 'size', 'checksum')})
        self.assertTrue(datasets_by_key(self.env)['document_files']['files'])

    def test_the_exported_columns_are_pinned(self):
        assert_columns_pinned(self, COLUMNS)
