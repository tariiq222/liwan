# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestPmoScope(TransactionCase):

    def test_explicit_services_are_global(self):
        self.assertEqual(self.env['webvue.pmo.settings']._webvue_scope, 'global')
