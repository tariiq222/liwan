# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The privacy hooks of the payments bridge: orders and transactions are kept, the payer's copy and saved methods go."""
import io

import openpyxl

from odoo import Command
from odoo.tests import tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_customers.models import privacy_hooks
from odoo.addons.liwan_payments.tests.common import LiwanPaymentsCase
from odoo.addons.liwan_payments_customers.models import privacy_hooks as payments_hooks

NAME = 'Hind Alotaibi'
PHONE = '+966501230002'
EMAIL = 'hind@example.test'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentsPrivacy(LiwanPaymentsCase):
    """The privacy service is called as the system administrator of the payments fixture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.customer = cls.env['liwan.customers.service']._liwan_create({'name': NAME, 'phone': PHONE, 'email': EMAIL})
        product = cls.env['product.product'].create({'name': 'Service', 'type': 'service', 'list_price': 100.0})
        cls.order = cls.env['sale.order'].create({
            'partner_id': cls.customer.id,
            'order_line': [Command.create({'product_id': product.id, 'product_uom_qty': 2})],
        })
        cls.card = cls.env.ref('payment.payment_method_card')
        cls.tx = cls.env['payment.transaction'].create({
            'provider_id': cls.paymob.id, 'payment_method_id': cls.card.id, 'amount': 230.0,
            'currency_id': cls.env.ref('base.SAR').id, 'partner_id': cls.customer.id, 'reference': 'PRIV-TX-1',
            'sale_order_ids': [Command.set(cls.order.ids)],
        })
        cls.tx.write({'partner_address': 'Olaya 12', 'partner_city': 'Riyadh', 'partner_zip': '12211', 'state': 'done'})
        cls.token = cls.env['payment.token'].create({
            'provider_id': cls.paymob.id, 'payment_method_id': cls.card.id, 'payment_details': '4242',
            'partner_id': cls.customer.id, 'provider_ref': 'gateway-token-1',
        })

    def chatter(self, *records):
        """How many messages the records carry, whatever their models."""
        return sum(self.env['mail.message'].search_count([('model', '=', record._name), ('res_id', '=', record.id)]) for record in records)

    @property
    def service(self):
        return self.env['liwan.customers.privacy.service'].with_user(self.admin)

    def items(self):
        return {item['key']: item for item in self.service._liwan_erase_preview(self.customer.id)['items']}

    def test_the_preview_lists_orders_as_retained_and_the_payer_copy_and_tokens_as_erased(self):
        items = self.items()
        expected = {
            payments_hooks.ORDER_KEY: ('retain', 1), payments_hooks.ORDER_LINE_KEY: ('retain', 1),
            payments_hooks.TRANSACTION_KEY: ('erase', 1), payments_hooks.TOKEN_KEY: ('erase', 1),
        }
        self.assertEqual({key: (items[key]['action'], items[key]['count']) for key in expected}, expected)
        self.assertTrue(all(items[key]['complete'] and items[key]['owner'] == 'liwan_payments_customers' for key in expected))

    def test_the_export_has_the_order_and_transaction_sheets(self):
        content, _filename, _logged = self.service._liwan_export(self.customer.id, 'Access request')
        workbook = openpyxl.load_workbook(io.BytesIO(content))
        orders = list(workbook['Online orders'].values)
        self.assertEqual((len(orders) - 1, orders[1][1]), (1, self.order.name))
        transactions = list(workbook['Payment transactions'].values)
        self.assertEqual((transactions[1][1], transactions[1][8]), ('PRIV-TX-1', EMAIL))

    def test_an_erase_keeps_the_order_and_the_transaction_and_clears_the_copy_and_the_token(self):
        order_before = (self.order.name, self.order.amount_total, self.order.state, self.order.partner_id.id)
        tx_before = (self.tx.reference, self.tx.amount, self.tx.state, self.tx.partner_id.id, self.tx.provider_reference)
        messages = self.chatter(self.customer, self.order)
        token = self.service._liwan_erase_preview(self.customer.id)['token']
        logged, counts = self.service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((counts[payments_hooks.TRANSACTION_KEY], counts[payments_hooks.TOKEN_KEY]), (1, 1))
        self.assertEqual(logged.counts[payments_hooks.ORDER_KEY], 1)
        self.env.invalidate_all()
        self.assertEqual((self.order.name, self.order.amount_total, self.order.state, self.order.partner_id.id), order_before)
        self.assertEqual(len(self.order.order_line), 1)
        self.assertEqual((self.tx.reference, self.tx.amount, self.tx.state, self.tx.partner_id.id, self.tx.provider_reference), tx_before)
        for name in payments_hooks.TRANSACTION_PERSONAL_FIELDS:
            self.assertFalse(self.tx[name], name)
        token = self.token.with_context(active_test=False)
        self.assertEqual((token.active, token.payment_details, token.provider_ref), (False, False, f'erased-{token.id}'))
        self.assertEqual(self.customer.with_context(active_test=False).name, privacy_hooks.ERASED_NAME % self.customer.id)
        self.assertEqual(self.chatter(self.customer, self.order), messages)
        self.assertFalse(self.env['mail.tracking.value'].search_count([('old_value_char', 'in', (NAME, EMAIL))]))

    def test_a_caller_who_cannot_see_the_transactions_is_refused_and_nothing_is_written(self):
        self.env['ir.rule'].create({
            'name': 'privacy test: hide transactions', 'model_id': self.env['ir.model']._get_id('payment.transaction'),
            'domain_force': '[(0, "=", 1)]',
        })
        token = self.service._liwan_erase_preview(self.customer.id)['token']
        by_key = self.items()
        self.assertEqual((by_key[payments_hooks.TRANSACTION_KEY]['complete'], by_key[payments_hooks.TRANSACTION_KEY]['count']), (False, 0))
        with self.assertRaises(LiwanAccessRule) as caught:
            self.service._liwan_erase(self.customer.id, token, NAME, 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.env.invalidate_all()
        self.assertEqual((self.customer.name, self.tx.partner_email, self.token.active), (NAME, EMAIL, True))
