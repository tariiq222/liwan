# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestPmoScope(TransactionCase):

    def test_explicit_services_are_global(self):
        self.assertEqual(self.env['liwan.pmo.settings']._liwan_scope, 'global')
