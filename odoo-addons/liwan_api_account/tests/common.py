# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase

TAX_ROUTE = '/api/v1/admin/company/tax'
PASSWORD = 'company_tax_pass_123'
VALID_VAT = '300000000000003'


class CompanyTaxCase(LiwanApiCase):
    """Two Saudi establishments and the people around them.

    The first (``root``, active ``branch`` and archived ``root_archived_branch``) has an administrator who
    belongs to both active companies (``establishment_admin``) and one who belongs to the root only
    (``root_admin``), a holder of ``settings.company.manage`` without the VAT right (``manage_only``), a reader
    (``reader``) and a plain employee. The second (``clean_root`` with an active and an archived branch) is
    where an Odoo system administrator changes the mode: no refusal of the first establishment masks it.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin_role = cls.env.ref('liwan_core.role_system_admin')
        cls.root = cls.saudi_root('Tax Root')
        cls.root.vat = VALID_VAT
        cls.branch = cls.saudi_branch(cls.root, 'Tax Branch')
        cls.root_archived_branch = cls.saudi_branch(cls.root, 'Tax Archived Branch')
        cls.env.flush_all()
        cls.root_archived_branch.active = False
        cls.env.flush_all()
        cls.establishment_admin = cls._member(
            'ct_establishment_admin', cls.root, [cls.root, cls.branch], {cls.root: cls.admin_role},
        )
        cls.root_admin = cls._member('ct_root_admin', cls.root, [cls.root], {cls.root: cls.admin_role})
        cls.branch_admin = cls._member('ct_branch_admin', cls.branch, [cls.branch], {cls.branch: cls.admin_role})
        cls.branch_employee = cls._member(
            'ct_branch_employee', cls.branch, [cls.branch],
            {cls.branch: cls.env.ref('liwan_core.role_employee')},
        )
        cls.manage_only = cls._member(
            'ct_manage_only', cls.root, [cls.root], {cls.root: cls._role('ct_manage', 'settings.company.manage')},
        )
        cls.reader = cls._member(
            'ct_reader', cls.root, [cls.root], {cls.root: cls._role('ct_read', 'settings.company.read')},
        )
        cls.employee = cls._member(
            'ct_employee', cls.root, [cls.root], {cls.root: cls.env.ref('liwan_core.role_employee')},
        )
        # The positive write runs here: a system administrator's root write and a reactivated archived branch.
        cls.clean_root = cls.saudi_root('Clean Root')
        cls.clean_root.vat = VALID_VAT
        cls.clean_branch = cls.saudi_branch(cls.clean_root, 'Clean Branch')
        cls.clean_archived_branch = cls.saudi_branch(cls.clean_root, 'Clean Archived Branch')
        cls.env.flush_all()
        cls.clean_archived_branch.active = False
        cls.env.flush_all()
        cls.system_admin = cls._system_admin(
            'ct_system_admin', cls.clean_root, cls.clean_root | cls.clean_branch,
        )

    @classmethod
    def saudi_root(cls, name, **vals):
        company = cls.env['res.company'].create({
            'name': name, 'country_id': cls.env.ref('base.sa').id,
            'currency_id': cls.env.ref('base.SAR').id, **vals,
        })
        cls.env['account.chart.template'].try_loading('sa', company)
        return company

    @classmethod
    def saudi_branch(cls, root, name):
        """A branch with the root's country and currency; the flush lets stock load its chart while it is active."""
        branch = cls.env['res.company'].create({
            'name': name, 'parent_id': root.id,
            'country_id': root.country_id.id, 'currency_id': root.currency_id.id,
        })
        cls.env.flush_all()
        return branch

    @classmethod
    def _role(cls, key, *permissions):
        records = cls.env['liwan.access.permission'].search([('key', 'in', list(permissions))])
        return cls.env['liwan.access.role'].create({
            'key': key, 'name_ar': key, 'type': 'built_in', 'permission_ids': [Command.set(records.ids)],
        })

    @classmethod
    def _system_admin(cls, login, home, companies):
        """An Odoo system administrator: the one identity ``res_company_rule_erp_manager`` admits every company to."""
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login,
            groups='liwan_core.group_employee,base.group_system',
            company_id=home.id, company_ids=[Command.set(companies.ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': cls.admin_role.id, 'company_id': home.id,
        })
        return user

    @classmethod
    def _member(cls, login, home, companies, roles):
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=home.id, company_ids=[Command.set([company.id for company in companies])],
        )
        for company, role in roles.items():
            cls.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': role.id, 'company_id': company.id,
            })
        return user

    def sign_in(self, login):
        return self.authenticate(login, PASSWORD)

    def fixture_user(self, login):
        """The fixture account behind a login: the identity the request runs as."""
        return self.env['res.users'].search([('login', '=', login)], limit=1)

    def get(self, login='ct_establishment_admin'):
        self.sign_in(login)
        return self.api('GET', TAX_ROUTE)

    def patch(self, payload, login='ct_establishment_admin'):
        self.sign_in(login)
        return self.api('PATCH', TAX_ROUTE, json=payload)

    def patch_as_system_admin(self, payload):
        """PATCH as the fixture's Odoo system administrator in the clean establishment."""
        self.sign_in('ct_system_admin')
        return self.api('PATCH', TAX_ROUTE, json=payload)

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def tax_group(self, company):
        group = self.env['account.tax.group'].search([('company_id', '=', company.id)], limit=1)
        return group or self.env['account.tax.group'].create({'name': 'VAT', 'company_id': company.id})

    def sale_tax(self, company, amount=15.0, name='Sale VAT'):
        return self.env['account.tax'].with_company(company).create({
            'name': name, 'company_id': company.id, 'amount': amount, 'type_tax_use': 'sale',
            'tax_group_id': self.tax_group(company).id,
        })

    def purchase_tax(self, company, amount=15.0, name='Purchase VAT'):
        return self.env['account.tax'].with_company(company).create({
            'name': name, 'company_id': company.id, 'amount': amount, 'type_tax_use': 'purchase',
            'tax_group_id': self.tax_group(company).id,
        })

    def invoice(self, company, tax, price_unit=115.0, quantity=1.0, move_type='out_invoice'):
        return self.env['account.move'].with_company(company).create({
            'move_type': move_type,
            'partner_id': self.customer(company).id,
            'invoice_date': '2026-11-13',
            'invoice_date_due': '2026-11-13',
            'invoice_line_ids': [Command.create({
                'name': 'Service', 'quantity': quantity, 'price_unit': price_unit, 'tax_ids': [Command.set(tax.ids)],
            })],
        })

    def customer(self, company):
        """A customer with the company's own receivable and payable accounts."""
        partner = self.env['res.partner'].create({'name': 'Tax customer', 'liwan_party': True})
        accounts = self.env['account.account'].search([('company_ids', 'in', company.ids)])
        partner.with_company(company).write({
            'property_account_receivable_id': accounts.filtered(
                lambda account: account.account_type == 'asset_receivable')[:1].id,
            'property_account_payable_id': accounts.filtered(
                lambda account: account.account_type == 'liability_payable')[:1].id,
        })
        return partner

    def line_totals(self, company, tax, price_unit, quantity=1.0, move_type='out_invoice'):
        line = self.invoice(company, tax, price_unit=price_unit, quantity=quantity, move_type=move_type).invoice_line_ids[0]
        return line.price_total, line.price_subtotal

    def establishment_with_mode(self, mode, branch=False):
        """A fresh Saudi establishment whose price mode is ``mode`` before any document exists.

        The mode cannot change once a journal item exists (stock's lock), so each measured mode needs its
        own establishment. The mode is written on the root: base's root-delegated propagation carries it to
        the branches, and a branch created afterwards starts from its root.
        """
        root = self.saudi_root(f'Measured {mode} {branch}')
        root.write({'account_price_include': mode})
        if not branch:
            return root, root
        return root, self.saudi_branch(root, f'Measured branch {mode}')
