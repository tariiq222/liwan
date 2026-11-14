# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase, record_contract_fixture

MANAGER_LOGIN = 'finance_manager'
MANAGER_PASSWORD = 'finance_manager_pass_123'
OUTSIDER_LOGIN = 'finance_outsider'
OUTSIDER_PASSWORD = 'finance_outsider_pass_123'

# The precondition the two fiscal setup writes state: the identity their screen was read for.
SETUP_EXPECTED_USER_HEADER = 'X-Liwan-Expected-User-Id'
SETUP_EXPECTED_COMPANY_HEADER = 'X-Liwan-Expected-Company-Id'

# The price mode these fixtures compute under: their figures add the 15% tax on top of the typed price. Stating it in
# the company's values keeps that arithmetic independent of stock's default and of the product's "price includes tax"
# default (liwan_api_account). A branch never states its own value: base copies its root's and refuses a difference.
TAX_EXCLUDED = 'tax_excluded'
TAX_INCLUDED = 'tax_included'


def company_values(name, price_mode=TAX_EXCLUDED, **values):
    """Values for a root company that states the price mode its expected figures are computed under."""
    return {'name': name, 'account_price_include': price_mode, **values}


class LiwanFinanceCase(LiwanApiCase):
    """The shared liwan_api fixture plus two Saudi companies with the l10n_sa chart,
    a finance manager and an outsider in the first one, and a posted sale invoice
    of 1000 SAR with 15% VAT in each company."""

    @classmethod
    def _assert_company_price_mode(cls, company, expected):
        """The fixture's figures only hold under the mode it states; fail loudly if a write moved it."""
        if company.account_price_include != expected:
            msg = f'{company.name} has the price mode {company.account_price_include!r}, not {expected!r}'
            raise AssertionError(msg)

    @classmethod
    def _saudi_company(cls, name, price_mode=TAX_EXCLUDED):
        saudi_arabia = cls.env.ref('base.sa')
        company = cls.env['res.company'].create(company_values(
            name, price_mode, country_id=saudi_arabia.id, currency_id=cls.env.ref('base.SAR').id,
        ))
        cls._assert_company_price_mode(company, price_mode)
        cls.env['account.chart.template'].try_loading('sa', company)
        # ZATCA phase 2 refuses to post until a journal is onboarded against ZATCA; the fixtures
        # sell through journals without that format. The ZATCA tests link it back where they need it.
        zatca = cls.env.ref('l10n_sa_edi.edi_sa_zatca')
        cls.env['account.journal'].search([('company_id', '=', company.id)]).edi_format_ids = [Command.unlink(zatca.id)]
        return company

    @classmethod
    def _fresh_company_manager(cls, name, login, password, price_mode=TAX_EXCLUDED):
        """A Saudi company as provisioning leaves it (the ``sa`` chart, nothing else) and a finance manager who works in it only."""
        company = cls.env['res.company'].create(company_values(
            name, price_mode, country_id=cls.env.ref('base.sa').id, currency_id=cls.env.ref('base.SAR').id,
        ))
        cls._assert_company_price_mode(company, price_mode)
        cls.env['account.chart.template'].try_loading('sa', company)
        user = new_test_user(
            cls.env, login=login, password=password, name=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': cls.env.ref('liwan_finance.role_finance_manager').id, 'company_id': company.id,
        }])
        return company

    @classmethod
    def _draft_sale_invoice(cls, company, partner):
        vat = cls.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'sale'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1)
        return cls.env['account.move'].with_company(company).create({
            'move_type': 'out_invoice',
            'partner_id': partner.id,
            'invoice_date': '2026-10-18',
            'invoice_date_due': '2026-10-18',  # fixed: Odoo otherwise derives the due date from today
            'invoice_line_ids': [Command.create({
                'name': 'Consulting', 'quantity': 1, 'price_unit': 1000, 'tax_ids': [Command.set(vat.ids)],
            })],
        })

    @classmethod
    def _sale_invoice(cls, company, partner):
        invoice = cls._draft_sale_invoice(company, partner)
        invoice.action_post()
        return invoice

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls._saudi_company('Finance Company A')
        cls.other_company = cls._saudi_company('Finance Company B')
        # The two charts exist only inside this transaction, so no statistics describe them yet. Without them the
        # planner nested-loops the stock account search behind a mis_builder report: seconds per balance sheet.
        cls.env.cr.execute('ANALYZE account_account, account_account_res_company_rel, res_company')
        cls.partner = cls.env['res.partner'].create({'name': 'Al Noor Trading', 'liwan_party': True})
        cls.manager = new_test_user(
            cls.env, login=MANAGER_LOGIN, password=MANAGER_PASSWORD, name='Finance Manager',
            groups='liwan_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_finance.role_finance_manager').id,
            'company_id': cls.company.id,
        }])
        cls.outsider = new_test_user(
            cls.env, login=OUTSIDER_LOGIN, password=OUTSIDER_PASSWORD, name='No finance access',
            groups='liwan_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.invoice = cls._sale_invoice(cls.company, cls.partner)
        cls.other_invoice = cls._sale_invoice(cls.other_company, cls.partner)

    def setup_api(self, method, path, *, user=None, company=None, json=None, headers=None):
        """One finance setup call that states the identity its screen was read for.

        ``user`` and ``company`` are the records whose ids the precondition headers carry. They are named
        explicitly, never read from the request environment, so a test can state another identity on
        purpose. ``headers`` replaces the whole header set, which is how the missing and malformed cases
        are stated — a header is never filled in for the caller.
        """
        if headers is None:
            if user is None or company is None:
                missing_identity = 'setup_api needs the user and the company it states, or explicit headers'
                raise AssertionError(missing_identity)
            headers = {
                SETUP_EXPECTED_USER_HEADER: str(user.id),
                SETUP_EXPECTED_COMPANY_HEADER: str(company.id),
            }
        response = self.url_open(
            path, json={} if json is None else json,
            headers={'Content-Type': 'application/json', **headers}, method=method,
        )
        record_contract_fixture(method, path, response)
        return response
