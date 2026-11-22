# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import ApprovalCase
from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_contribution,
    datasets_by_key,
)


class TestTenantExport(ApprovalCase):

    def test_the_datasets_are_declared_and_read_without_secrets(self):
        datasets = assert_contribution(self, ('operation_processes', 'operation_steps', 'operation_requests'))
        self.assertEqual({key: dataset['models'] for key, dataset in datasets.items() if key.startswith('operation_')}, {
            'operation_processes': ('liwan.operation.process',),
            'operation_steps': ('liwan.operation.process.step',),
            'operation_requests': ('liwan.operation.request',),
        })

    def test_only_the_requests_carry_their_files(self):
        datasets = datasets_by_key(self.env)
        self.assertTrue(datasets['operation_requests']['files'])
        self.assertFalse(datasets['operation_processes']['files'])

    def test_the_audit_log_is_declared_a_technical_model(self):
        technical = self.env['liwan.tenant.export.hooks']._liwan_export_technical_models()
        self.assertIn('liwan.operation.event', technical)
