# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestChatScope(TransactionCase):
    def test_registers_its_terminology_keys(self):
        owned = frozenset({
            'nav.chat',
            'chat.title',
        })
        registered = self.env['nasq.entitlement.service']._nasq_terminology_keys()
        self.assertLessEqual(owned, registered)

    def test_explicit_services_are_global(self):
        self.assertEqual(self.env['nasq.chat.service']._nasq_scope, 'global')
