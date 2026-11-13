# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A customer with a lead, a posted invoice, an online order, a transaction and a conversation is erased in one request.

This is the proof that no installed application leaves the erase refused: CRM, Finance, Customer Messages and the
payments bridge each contribute their part, and the preview lists nothing as incomplete.
"""
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanCatalogCase
from odoo.addons.liwan_customers.models import privacy_hooks

NAME = 'Maha Alsubaie'
PHONE = '+966501230003'
EMAIL = 'maha@example.test'
WA_ID = '966501230003'


@tagged('post_install', '-at_install', 'liwan')
class TestCustomerEraseEndToEnd(LiwanCatalogCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.person = cls.env['liwan.customers.service']._liwan_create({'name': NAME, 'phone': PHONE, 'email': EMAIL})
        cls.erase_admin = new_test_user(
            cls.env, login='erase_e2e_admin', password='erase_e2e_admin_pass_123', name='Erase admin',
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.erase_admin, [
            {'role_id': cls.env.ref(role).id, 'company_id': company.id}
            for role in (
                'liwan_core.role_system_admin', 'liwan_crm.role_crm_manager', 'liwan_finance.role_finance_manager',
                'liwan_inbox.role_inbox_manager',
            )
        ])
        cls.lead = cls.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True).create({
            'name': 'Maha', 'type': 'opportunity', 'company_id': company.id, 'partner_id': cls.person.id,
            'contact_name': NAME, 'email_from': EMAIL, 'phone': PHONE,
        })
        cls.invoice = cls.env['account.move'].create({
            'move_type': 'out_invoice', 'partner_id': cls.person.id, 'currency_id': cls.env.ref('base.SAR').id,
            'invoice_date': '2026-10-28', 'invoice_date_due': '2026-11-27',
            'invoice_line_ids': [Command.create({'name': 'Service', 'quantity': 1, 'price_unit': 115.0, 'tax_ids': []})],
        })
        cls.invoice.action_post()
        service = cls.env['liwan.payments.service']
        order = service._liwan_new_order(company, cls.person, 1.0)
        service._liwan_add_line(order, cls.service)
        cls.sale_order = cls.env['sale.order'].browse(order.id)
        cls.paid = cls.env['payment.transaction'].create({
            'provider_id': cls.paymob.id, 'payment_method_id': cls.card.id, 'amount': 115.0,
            'currency_id': cls.env.ref('base.SAR').id, 'partner_id': cls.person.id, 'reference': 'E2E-TX-1',
            'sale_order_ids': [Command.set(cls.sale_order.ids)],
        })
        cls.conversation = cls.make_conversation()
        cls.contact = cls.conversation.contact_id
        cls.contact.write({'partner_id': cls.person.id, 'name': NAME, 'email': EMAIL})

    def test_a_customer_with_a_record_in_every_application_is_erased_without_a_refusal(self):
        service = self.env['liwan.customers.privacy.service'].with_user(self.erase_admin)
        preview = service._liwan_erase_preview(self.person.id)
        self.assertEqual(preview['incomplete'], [])
        counts = {item['key']: item['count'] for item in preview['items']}
        for key in ('crm_leads', 'finance_documents', 'payment_orders', 'payment_transactions', 'inbox_contacts', 'inbox_messages'):
            self.assertGreaterEqual(counts[key], 1, key)
        logged, erased = service._liwan_erase(self.person.id, preview['token'], NAME, 'Request')
        self.assertEqual(logged.counts, erased)
        self.env.invalidate_all()
        self.assertEqual(self.person.with_context(active_test=False).name, privacy_hooks.ERASED_NAME % self.person.id)
        self.assertFalse(self.lead.with_context(active_test=False).email_from)
        self.assertEqual((self.invoice.state, self.invoice.amount_total, self.invoice.partner_id), ('posted', 115.0, self.person))
        self.assertEqual(self.sale_order.partner_id, self.person)
        self.assertFalse(self.paid.partner_email)
        self.assertEqual(self.paid.reference, 'E2E-TX-1')
        self.assertNotEqual(self.contact.name, NAME)
        self.assertFalse(self.contact.email)
        self.assertEqual(self.conversation.state, 'closed')
