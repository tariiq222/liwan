# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from .tenant_export_columns import COLUMNS
from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_columns_pinned,
    assert_contribution,
    datasets_by_key,
)

KEYS = ('operation_processes', 'operation_steps', 'operation_requests')


@tagged('post_install', '-at_install', 'liwan')
class TestOperationsTenantExport(TransactionCase):

    def test_the_datasets_read_and_requests_carry_their_files(self):
        assert_contribution(self, KEYS)
        self.assertTrue(datasets_by_key(self.env)['operation_requests']['files'])

    def test_the_exported_columns_are_pinned(self):
        assert_columns_pinned(self, COLUMNS)
