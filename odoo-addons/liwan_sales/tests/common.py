# Part of Odoo. See LICENSE file for full copyright and licensing details.
from typing import NamedTuple

from odoo import Command
from odoo.models import BaseModel
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase


class Scope(NamedTuple):
    """A company a test works in and the three users homed there: two agents and a manager."""

    company: BaseModel
    agent: BaseModel
    agent2: BaseModel
    manager: BaseModel


MODES = {'saas': 'control_plane', 'non_saas': 'local_policy'}


class LiwanSalesCase(LiwanApiCase):
    """The shared liwan_api fixture plus Sales users in the root company and in one of its branches."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Sales branch', 'parent_id': cls.company.id})
        cls.other_company = cls.env['res.company'].create({'name': 'Other Sales company'})
        cls.root = Scope(
            cls.company,
            cls._member('sales_agent', cls.company, 'liwan_sales.role_sales_agent'),
            cls._member('sales_agent2', cls.company, 'liwan_sales.role_sales_agent'),
            cls._member('sales_manager', cls.company, 'liwan_sales.role_sales_manager'),
        )
        cls.in_branch = Scope(
            cls.branch,
            cls._member('sales_b_agent', cls.branch, 'liwan_sales.role_sales_agent'),
            cls._member('sales_b_agent2', cls.branch, 'liwan_sales.role_sales_agent'),
            cls._member('sales_b_manager', cls.branch, 'liwan_sales.role_sales_manager'),
        )
        cls.scopes = {'root': cls.root, 'branch': cls.in_branch}
        cls.agent, cls.agent2, cls.manager = cls.root.agent, cls.root.agent2, cls.root.manager
        cls.outsider = new_test_user(
            cls.env, login='sales_outsider', password='sales_outsider_pass_123',
            name='No Sales access', groups='liwan_core.group_employee',
        )
        cls.product = cls.env['product.product'].create({
            'name': 'Sales service', 'type': 'service', 'list_price': 50.0, 'taxes_id': [Command.clear()],
        })

    @classmethod
    def _member(cls, login, company, role_xmlid):
        """A user homed in ``company`` who holds ``role_xmlid`` there and nowhere else."""
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set([company.id])],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': cls.env.ref(role_xmlid).id, 'company_id': company.id,
        })
        return user

    @classmethod
    def custom_user(cls, login, capability_keys, company=None):
        """A user homed in ``company`` (default: the root) whose only role is a custom one of ``capability_keys``."""
        company = company or cls.company
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set([company.id])],
        )
        cls.give_custom_role(user, capability_keys, company)
        return user

    @classmethod
    def give_custom_role(cls, user, capability_keys, company=None):
        """Replace the user's assignments by one custom role of ``capability_keys``."""
        company = company or cls.company
        label = f'{user.login} {" ".join(sorted(capability_keys))}'
        Role = cls.env['liwan.access.role'].with_company(company)
        key = label.replace(' ', '_')
        role = Role.search([('key', '=', key)]) or Role.create({
            'key': key, 'name_ar': label, 'name_en': label,
            'type': 'custom', 'assignable': True,
            'permission_ids': [Command.set(
                cls.env['liwan.access.permission'].search([('key', 'in', sorted(capability_keys))]).ids,
            )],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': company.id,
        }])

    def as_user(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self

    def set_mode(self, mode):
        """Fixture-only conversion of the tenant between the two commercial modes."""
        profile = self.env.ref('liwan_platform.tenant_profile')
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
            [mode, MODES[mode], profile.id],
        )
        profile.invalidate_recordset()

    @classmethod
    def set_visibility(cls, mode):
        cls.env['liwan.sales.settings']._liwan_current().visibility = mode
        cls.env.registry.clear_cache()

    @classmethod
    def make_order(cls, user=None, company=None, staff=True, lines=None, **values):
        """A quotation made as the superuser; ``user`` None leaves it unassigned, as an online order is."""
        company = company or cls.company
        partner = cls.env['res.partner'].create({'name': values.pop('customer', 'Customer')})
        Order = cls.env['sale.order'].with_company(company).with_context(mail_auto_subscribe_no_notify=True)
        if lines is None:
            lines = [Command.create({
                'product_id': cls.product.id, 'product_uom_qty': 2, 'price_unit': 50.0, 'discount': 10,
            })]
        return Order.create({
            'partner_id': partner.id,
            'company_id': company.id,
            'user_id': user.id if user else False,
            'liwan_staff_document': staff,
            'order_line': lines,
            **values,
        })

    def api_as(self, user, method, path, json=None):
        return self.as_user(user).api(method, path, json=json)


SAUDI_VAT = '300000000000003'
CATALOG_KEYS = ('products.read', 'products.manage', 'products.prices.manage')


class SalesWriteCase(LiwanSalesCase):
    """The Sales users of ``LiwanSalesCase`` in an establishment registered for VAT, with two 15% sale taxes of the
    root (one added to the price, one included in it), service products of the product service and parties of the
    customer service."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.write({'country_id': cls.env.ref('base.sa').id, 'vat': SAUDI_VAT})
        cls.register(True)
        cls.tax_added = cls.tax('VAT 15% added', 'tax_excluded')
        cls.tax_included = cls.tax('VAT 15% included', 'tax_included')
        cls.catalog = cls.custom_user('sales_catalog', CATALOG_KEYS)
        cls.taxed = cls.service_product('Taxed service', 100.0, cls.tax_added)
        cls.included = cls.service_product('Tax-included service', 100.0, cls.tax_included)
        cls.plain = cls.service_product('Default-tax service', 40.0)
        cls.customer = cls.party('Sales customer')

    @classmethod
    def register(cls, registered):
        cls.company.liwan_vat_registered = registered

    @classmethod
    def tax(cls, name, price_include):
        group = cls.env['account.tax.group'].create({'name': f'{name} group', 'company_id': cls.company.id})
        return cls.env['account.tax'].create({
            'name': name, 'amount': 15.0, 'amount_type': 'percent', 'type_tax_use': 'sale',
            'company_id': cls.company.id, 'tax_group_id': group.id, 'price_include_override': price_include,
        })

    @classmethod
    def products_service(cls, user=None, company=None):
        service = cls.env['liwan.products.service']
        return service.with_user(user or cls.catalog).with_company(company or cls.company)

    @classmethod
    def service_product(cls, name, price, taxes=None, user=None, company=None):
        """A ``product.template`` of the product service, priced at ``price``, with ``taxes`` (default: the
        establishment's default sale tax, as the product service gives it)."""
        values = {'name': name, 'type': 'service', 'list_price': price}
        if taxes:
            values['taxes'] = taxes.ids
        return cls.products_service(user, company)._liwan_create(values).with_env(cls.env)

    @classmethod
    def party(cls, name, company=None):
        """A party of the customer service; ``company`` makes it that company's own (default: shared)."""
        settings = cls.env['liwan.customers.settings']._liwan_current()
        service = cls.env['liwan.customers.service']
        if not company:
            return service._liwan_create({'name': name})
        settings.sharing = 'branch'
        party = service.with_company(company)._liwan_create({'name': name})
        settings.sharing = 'establishment'
        return party

    @classmethod
    def set_discount_limit(cls, percent):
        cls.env['liwan.sales.settings']._liwan_current().discount_limit_percent = percent

    @staticmethod
    def product_line(product, quantity=1, **extra):
        return {'kind': 'product', 'product_id': product.id, 'quantity': quantity, **extra}

    def body(self, *lines, **extra):
        return {'customer_id': self.customer.id, 'lines': list(lines or [self.product_line(self.taxed)]), **extra}

    def post(self, user, body, expect=200):
        response = self.api_as(user, 'POST', '/api/v1/sales/orders', body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def patch_order(self, user, order_id, body, expect=200):
        response = self.api_as(user, 'PATCH', f'/api/v1/sales/orders/{order_id}', body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def act(self, user, order_id, action, body=None, expect=200):
        response = self.api_as(user, 'POST', f'/api/v1/sales/orders/{order_id}/{action}', body)
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def refused(self, response, status, code, field=None):
        """The error body of ``response``, after checking its status, code and field."""
        self.assertEqual(response.status_code, status, response.text)
        body = response.json()
        self.assertEqual((body['code'], body.get('field')), (code, field), response.text)
        return body

    def price_of(self, product, quantity, company=None):
        """The unit price the price function gives ``product`` for the Sales customer."""
        company = company or self.company
        service = self.env['liwan.products.service'].with_company(company)
        return service._liwan_price(product, quantity=quantity, company=company, customer=self.customer)['unit_price']
