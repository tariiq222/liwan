# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_sales.tests.common import QuotationCase

LEADS = '/api/v1/crm/opportunities'
ORDERS = '/api/v1/sales/orders'
SETTINGS = '/api/v1/sales/settings'
PUBLIC = '/api/v1/public/sales/quotations'
SALES_ROLES = ('liwan_sales.role_sales_agent', 'liwan_sales.role_sales_manager')
CRM_ROLES = ('liwan_crm.role_crm_agent', 'liwan_crm.role_crm_manager')


class SalesCrmMixin:
    """Sellers who hold a Sales role and a CRM role, a CRM-only agent, and opportunities linked to the Sales customer."""

    @classmethod
    def setup_crm(cls):
        cls.seller = cls.both('crm_seller', 0, 0)
        cls.seller2 = cls.both('crm_seller2', 0, 0)
        cls.boss = cls.both('crm_boss', 1, 1)
        cls.branch_seller = cls.both('crm_branch_seller', 0, 0, company=cls.branch)
        cls.crm_only = cls.member_of('crm_only', cls.company, CRM_ROLES[0])

    @classmethod
    def member_of(cls, login, company, *roles):
        user = cls._member(login, company, roles[0])
        for role in roles[1:]:
            cls.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': cls.env.ref(role).id, 'company_id': company.id,
            })
        return user

    @classmethod
    def both(cls, login, sales, crm, company=None):
        return cls.member_of(login, company or cls.company, SALES_ROLES[sales], CRM_ROLES[crm])

    @classmethod
    def lead(cls, user=None, company=None, customer=True, **values):
        """An opportunity of ``user`` made as the superuser, linked to the Sales customer unless ``customer`` is falsy."""
        company = company or cls.company
        Lead = cls.env['crm.lead'].with_company(company).with_context(mail_auto_subscribe_no_notify=True)
        partner = cls.customer if customer is True else customer
        return Lead.create({
            'name': 'Opportunity', 'contact_name': 'Opportunity', 'type': 'opportunity', 'company_id': company.id,
            'user_id': user.id if user else False, 'partner_id': partner.id if partner else False, **values,
        })

    @classmethod
    def set_crm_visibility(cls, mode):
        settings = cls.env['liwan.crm.settings']
        row = settings.search([('company_id', '=', cls.company.id)]) or settings.create({'company_id': cls.company.id})
        row.visibility = mode

    def feature(self, key, enabled):
        set_probe_feature(self, key=key, enabled=enabled)

    def from_lead(self, user, lead, expect=200):
        response = self.api_as(user, 'POST', f'{LEADS}/{lead.id}/orders', {})
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def listed(self, user, lead, expect=200):
        response = self.api_as(user, 'GET', f'{LEADS}/{lead.id}/orders')
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def confirmed_order(self, lead, user=None, **values):
        """A confirmed staff order for ``lead``, made as the superuser through the Sales service (the win path)."""
        order = self.make_order(user or self.seller, liwan_lead_id=lead.id, **values)
        self.confirm(order)
        return order

    def confirm(self, order):
        self.env['liwan.sales.service']._liwan_move(order, 'confirm')
        order.invalidate_recordset()
        return order


class SalesCrmCase(SalesCrmMixin, QuotationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_crm()
