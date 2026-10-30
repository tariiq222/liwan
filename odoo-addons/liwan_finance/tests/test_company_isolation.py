# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the Finance pillar's GET record routes.

The matrix is written to the target contract: a foreign company gets the
route's byte-identical not-found answer under every company forgery, never a
403 that marks the record real.

A branch company shares its parent's chart of accounts in Odoo 19 and holds no
journals of its own (the chart loader only loads the company settings for a
child), so financial records exist for the two root companies P and C only.
The branch dimension — a parent session reading its branches, a branch session
never reading the parent — is covered by the partner routes, which need no
chart.
"""
from odoo import Command
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
    exempt_isolation_route,
)

# (current company tag, tags visible through the pinned set, tags that must stay hidden).
# Only root companies carry a chart, so only they own financial records.
MATRIX = (
    ('p', ('p',), ('c',)),
    ('c', ('c',), ('p',)),
)
# The branch dimension of the pin, measured on the partner routes.
PARTNER_MATRIX = (
    ('p', ('p', 'p1', 'p2', 'shared'), ('c',)),
    ('p1', ('p1', 'shared'), ('p', 'p2', 'c')),
)

# The GET record routes of the pillar and the fixture key each path reads.
RECORD_ROUTES = {
    'invoice': '/api/v1/finance/invoices/{}',
    'zatca': '/api/v1/finance/invoices/{}/zatca',
    'entry': '/api/v1/finance/entries/{}',
    'statement': '/api/v1/finance/bank-statements/{}',
    'budget': '/api/v1/finance/budgets/{}',
    'asset': '/api/v1/finance/assets/{}',
    'profile': '/api/v1/finance/asset-profiles/{}',
    'analytic': '/api/v1/finance/analytic-accounts/{}',
    'term': '/api/v1/finance/payment-terms/{}',
    'tax': '/api/v1/finance/taxes/{}',
    'journal': '/api/v1/finance/journals/{}',
    'account': '/api/v1/finance/accounts/{}',
}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceCompanyIsolation(CompanyIsolationCase):
    """The company matrix over every Finance GET record route."""

    @classmethod
    def chart_account(cls, code, company):
        """One account of the company's own chart, by its template code."""
        return cls.env['account.account'].with_company(company).search(
            [('code', '=', code), ('company_ids', 'in', company.ids)], limit=1,
        )

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        # The finance manager role is added on top of the employee role, in every
        # company, so a visibility difference can only come from the pinned
        # request company, never from a missing capability.
        Assignment = cls.env['liwan.access.assignment'].sudo()
        for company in cls.by_tag.values():
            Assignment.create({
                'user_id': cls.iso_user.id,
                'role_id': cls.env.ref('liwan_finance.role_finance_manager').id,
                'company_id': company.id,
            })
        # Only a root company carries a chart in Odoo 19: loading the chart on a
        # child only loads the company settings, and the branch shares the parent's
        # accounts without journals of its own. The financial records therefore
        # belong to the two roots; partners exist for every company, so the branch
        # dimension of the pin is measured on the partner routes.
        cls.chart_tags = ('p', 'c')
        for tag in cls.chart_tags:
            company = cls.by_tag[tag]
            company.write({
                'country_id': cls.env.ref('base.sa').id,
                'currency_id': cls.env.ref('base.SAR').id,
            })
            cls.env['account.chart.template'].try_loading('sa', company)
        cls.env.cr.execute('ANALYZE account_account, account_account_res_company_rel, res_company')
        cls.shared_partner = cls.env['res.partner'].create({'name': 'Shared Partner'})
        # Analytic plans are database-wide in Odoo 19 (no company field); only the
        # accounts under a plan carry a company.
        cls.analytic_plan = cls.env['account.analytic.plan'].create({'name': 'Isolation Plan'})
        cls.recs = {}
        for tag, company in cls.by_tag.items():
            cls.recs[tag] = {
                'partner': cls.env['res.partner'].create({
                    'name': f'Partner {tag.upper()}', 'company_id': company.id,
                }),
            }
        for tag in cls.chart_tags:
            company = cls.by_tag[tag]
            partner = cls.recs[tag]['partner']
            vat = cls.env['account.tax'].search([
                ('company_id', '=', company.id), ('type_tax_use', '=', 'sale'),
                ('amount_type', '=', 'percent'), ('amount', '=', 15),
            ], limit=1)
            bank = cls.env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'bank')], limit=1)
            general = cls.env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'general')], limit=1)
            profile = cls.env['account.asset.profile'].with_company(company).create({
                'name': f'Profile {tag.upper()}', 'company_id': company.id,
                'account_asset_id': cls.chart_account('106002', company).id,
                'account_depreciation_id': cls.chart_account('106007', company).id,
                'account_expense_depreciation_id': cls.chart_account('400064', company).id,
                'journal_id': general.id,
                'method': 'linear', 'method_time': 'year', 'method_number': 5, 'method_period': 'year',
            })
            invoice = cls.env['account.move'].with_company(company).create({
                'move_type': 'out_invoice', 'partner_id': partner.id,
                'invoice_date': '2026-10-18', 'invoice_date_due': '2026-10-18',
                'invoice_line_ids': [Command.create({
                    'name': 'Consulting', 'quantity': 1, 'price_unit': 100, 'tax_ids': [Command.set(vat.ids)],
                })],
            })
            cls.recs[tag].update({
                'invoice': invoice,
                # The ZATCA route is the invoice route: it reads the invoice's own submission.
                'zatca': invoice,
                'entry': cls.env['account.move'].with_company(company).create({
                    'move_type': 'entry', 'date': '2026-10-20', 'journal_id': general.id,
                    'line_ids': [
                        Command.create({'account_id': cls.chart_account('101001', company).id,
                                        'debit': 100, 'credit': 0, 'name': 'entry'}),
                        Command.create({'account_id': cls.chart_account('500001', company).id,
                                        'debit': 0, 'credit': 100, 'name': 'entry'}),
                    ],
                }),
                'statement': cls.env['account.bank.statement'].with_company(company).create({
                    'date': '2026-10-31',
                    'line_ids': [Command.create({
                        'journal_id': bank.id, 'date': '2026-10-31', 'payment_ref': f'Line {tag.upper()}', 'amount': 10,
                    })],
                }),
                'budget': cls.env['mis.budget.by.account'].create({
                    'name': f'Budget {tag.upper()}', 'date_from': '2026-01-01', 'date_to': '2026-12-31',
                    'company_id': company.id,
                }),
                'profile': profile,
                'asset': cls.env['account.asset'].with_company(company).create({
                    'name': f'Asset {tag.upper()}', 'profile_id': profile.id, 'purchase_value': 500,
                    'date_start': '2026-01-01',
                }),
                'analytic': cls.env['account.analytic.account'].create({
                    'name': f'Analytic {tag.upper()}', 'plan_id': cls.analytic_plan.id, 'company_id': company.id,
                }),
                'term': cls.env['account.payment.term'].create({
                    'name': f'Terms {tag.upper()}', 'company_id': company.id,
                    'line_ids': [Command.create({'value': 'percent', 'value_amount': 100})],
                }),
                'tax': vat,
                'journal': bank,
                'account': cls.chart_account('106002', company),
            })

    def assert_hidden_every_way(self, path, hidden_id):
        """404 with not_found on the plain call and every company forgery.

        The finance not-found bodies name the requested model and id, so they
        are pinned by status and code instead of byte identity: the wording
        depends only on the caller's own id and proves nothing about a record.
        """
        for response in self.api_forged('GET', path, hidden_id):
            self.assertEqual(response.status_code, 404, f'{path} must stay hidden: {response.text[:200]}')
            self.assertEqual(response.json()['code'], 'not_found', path)

    def assert_matrix(self, kind):
        """The owning root company reads the record; the other root gets the not-found."""
        template = RECORD_ROUTES[kind]
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                self.assertVisible(template.format(self.recs[tag][kind].id))
            for tag in hidden:
                record = self.recs[tag][kind]
                self.assert_hidden_every_way(template.format(record.id), record.id)

    # --- the record matrix, one test per GET record route ------------------------------------------

    def test_invoice_record_is_company_scoped(self):
        self.assert_matrix('invoice')

    def test_zatca_submission_record_is_company_scoped(self):
        self.assert_matrix('zatca')

    def test_entry_record_is_company_scoped(self):
        self.assert_matrix('entry')

    def test_bank_statement_record_is_company_scoped(self):
        self.assert_matrix('statement')

    def test_budget_record_is_company_scoped(self):
        self.assert_matrix('budget')

    def test_asset_record_is_company_scoped(self):
        self.assert_matrix('asset')

    def test_asset_profile_record_is_company_scoped(self):
        self.assert_matrix('profile')

    def test_analytic_account_record_is_company_scoped(self):
        self.assert_matrix('analytic')

    def test_payment_term_record_is_company_scoped(self):
        self.assert_matrix('term')

    def test_tax_record_is_company_scoped(self):
        self.assert_matrix('tax')

    def test_journal_record_is_company_scoped(self):
        self.assert_matrix('journal')

    def test_account_record_is_company_scoped(self):
        self.assert_matrix('account')

    # --- the partner routes: the pinned set plus the shared reference ------------------------------

    def test_partner_matrix_follows_the_pinned_set(self):
        """From P1 the parent's and the sibling's partners are hidden and the shared one is
        visible; from P the branch partners are visible; C's partner stays hidden."""
        for current, visible, hidden in PARTNER_MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                partner = self.shared_partner if tag == 'shared' else self.recs[tag]['partner']
                self.assertVisible(f'/api/v1/finance/partners/{partner.id}')
            for tag in hidden:
                partner = self.recs[tag]['partner']
                self.assert_hidden_every_way(f'/api/v1/finance/partners/{partner.id}', partner.id)

    def test_shared_partner_is_visible_and_c_partner_hidden_everywhere(self):
        """A company-less partner is reference data for every current; C's partner only from C."""
        for current in ('p', 'p1', 'p2', 'c'):
            self.env_in(self.by_tag[current])
            self.assertVisible(f'/api/v1/finance/partners/{self.shared_partner.id}')
            if current == 'c':
                self.assertVisible(f'/api/v1/finance/partners/{self.recs["c"]["partner"].id}')
        for current in ('p', 'p1', 'p2'):
            self.env_in(self.by_tag[current])
            partner = self.recs['c']['partner']
            self.assert_hidden_every_way(f'/api/v1/finance/partners/{partner.id}', partner.id)

    def test_partner_write_of_hidden_company_is_404(self):
        """A PATCH renaming another company's partner answers not-found and writes nothing."""
        self.env_in(self.company_p1)
        target = self.recs['p']['partner']
        for response in self.api_forged('PATCH', f'/api/v1/finance/partners/{target.id}', target.id,
                                        json={'name': 'Forged'}):
            self.assertEqual(response.status_code, 404, response.text[:200])
            self.assertEqual(response.json()['code'], 'not_found')
        self.assertEqual(target.name, 'Partner P')

    def test_partner_list_scoped_to_the_current_company(self):
        """From P1 the partner list carries P1's partner and the shared reference.

        Other company-less partners may exist in the shared database (they are
        reference data every company reads), so the list is pinned by including
        the readable ones and excluding every company-owned partner outside the
        pinned set.
        """
        self.env_in(self.company_p1)
        body = self.assertVisible('/api/v1/finance/partners').json()
        ids = {item['id'] for item in body['items']}
        self.assertIn(self.recs['p1']['partner'].id, ids)
        self.assertIn(self.shared_partner.id, ids)
        for tag in ('p', 'p2', 'c'):
            self.assertNotIn(self.recs[tag]['partner'].id, ids, tag)

    def test_partner_create_scopes_to_the_current_company(self):
        """A partner created from a P1 session belongs to P1 and is hidden from P2."""
        self.env_in(self.company_p1)
        response = self.api('POST', '/api/v1/finance/partners', json={'name': 'Created In P1'})
        self.assertEqual(response.status_code, 201, response.text[:200])
        partner = self.env['res.partner'].browse(response.json()['id'])
        self.assertEqual(partner.company_id.id, self.company_p1.id)
        self.env_in(self.company_p2)
        self.assert_hidden_every_way(f'/api/v1/finance/partners/{partner.id}', partner.id)


cover_isolation_routes((
    '/api/v1/finance/invoices/<int:invoice_id>',
    '/api/v1/finance/invoices/<int:invoice_id>/zatca',
    '/api/v1/finance/entries/<int:entry_id>',
    '/api/v1/finance/bank-statements/<int:statement_id>',
    '/api/v1/finance/budgets/<int:budget_id>',
    '/api/v1/finance/assets/<int:asset_id>',
    '/api/v1/finance/asset-profiles/<int:profile_id>',
    '/api/v1/finance/analytic-accounts/<int:account_id>',
    '/api/v1/finance/payment-terms/<int:term_id>',
    '/api/v1/finance/taxes/<int:tax_id>',
    '/api/v1/finance/journals/<int:journal_id>',
    '/api/v1/finance/accounts/<int:account_id>',
    '/api/v1/finance/partners/<int:partner_id>',
), source='liwan_finance/tests/test_company_isolation.py')
exempt_isolation_route(
    '/api/v1/finance/countries/<int:country_id>/states',
    'reference data shared by every company',
)
exempt_isolation_route(
    '/api/v1/finance/analytic-plans/<int:plan_id>',
    'analytic plans are shared by every company: the stock model has no company field',
)
