# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase

ENTRY_KEYS = {
    'id', 'project_id', 'kind', 'title', 'amount', 'expense_date',
    'reference', 'notes', 'budget_entry_id', 'updated_at',
}
SUMMARY_KEYS = {
    'project_id', 'currency', 'charter_estimate', 'planned', 'actual', 'remaining',
    'utilization_percent', 'over_budget', 'budget_count', 'expense_count',
}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectFinance(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The shared fixture models legacy company-less projects. Finance is
        # explicitly company-scoped, so use a current-company fixture here.
        cls.project.company_id = cls.env.company

    def _url(self, suffix=''):
        return f'/api/v1/projects/{self.project.id}/finance{suffix}'

    def test_crud_and_summary_lifecycle(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        empty = self.api('GET', self._url()).json()
        self.assertEqual(set(empty), {'items', 'total', 'can_manage', 'summary'})
        self.assertEqual((empty['total'], empty['can_manage']), (0, True))
        self.assertEqual(set(empty['summary']), SUMMARY_KEYS)
        self.assertIsNone(empty['summary']['planned'])
        self.assertEqual(empty['summary']['actual'], 0)

        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'Design phase', 'amount': 1000})
        self.assertEqual(res.status_code, 201, res.text)
        budget = res.json()
        self.assertEqual(set(budget), ENTRY_KEYS)
        self.assertEqual((budget['kind'], budget['amount'], budget['expense_date'], budget['budget_entry_id']),
                          ('budget', 1000, None, None))
        self.assertEqual(budget['updated_at'], 'v1')

        res = self.api('POST', self._url(), {
            'kind': 'expense', 'title': 'Contractor', 'amount': 250,
            'expense_date': '2030-01-15', 'budget_entry_id': budget['id'],
        })
        self.assertEqual(res.status_code, 201, res.text)
        expense = res.json()
        self.assertEqual(expense['budget_entry_id'], budget['id'])

        listed = self.api('GET', self._url()).json()
        self.assertEqual(listed['total'], 2)
        self.assertEqual(listed['summary']['planned'], 1000)
        self.assertEqual(listed['summary']['actual'], 250)

        detail = self.api('GET', self._url(f"/{expense['id']}")).json()
        self.assertEqual(detail, expense)

        res = self.api('PATCH', self._url(f"/{expense['id']}"), {
            'amount': 300, 'expected_updated_at': expense['updated_at'],
        })
        self.assertEqual(res.status_code, 200, res.text)
        updated = res.json()
        self.assertEqual((updated['amount'], updated['updated_at']), (300, 'v2'))

        res = self.api('DELETE', self._url(f"/{expense['id']}"), {'expected_updated_at': updated['updated_at']})
        self.assertEqual((res.status_code, res.json()), (200, {'deleted': True}))
        self.assertEqual(self.api('GET', self._url()).json()['total'], 1)

    def test_employee_cannot_manage_but_can_read(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='B', amount=100)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', self._url()).json()['can_manage'], False)
        self.assertEqual(self.api('GET', self._url(f"/{budget['id']}")).status_code, 200)
        self.assertEqual(
            self.api('POST', self._url(), {'kind': 'budget', 'title': 'x', 'amount': 1}).status_code, 403,
        )
        self.assertEqual(
            self.api('PATCH', self._url(f"/{budget['id']}"),
                      {'title': 'x', 'expected_updated_at': budget['updated_at']}).status_code,
            403,
        )
        self.assertEqual(
            self.api('DELETE', self._url(f"/{budget['id']}"), {'expected_updated_at': budget['updated_at']}).status_code,
            403,
        )

    def test_unknown_budget_vs_explicit_zero(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertIsNone(summary['planned'])
        self.assertIsNone(summary['utilization_percent'])
        self._create(kind='budget', title='Zero budget', amount=0)
        summary = self.api('GET', self._url('/summary')).json()
        self.assertEqual(summary['planned'], 0)
        self.assertIsNone(summary['utilization_percent'])
        self.assertEqual(summary['budget_count'], 1)

    def test_budget_1000_expense_250_totals_750(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._create(kind='budget', title='Total budget', amount=1000)
        self._create(kind='expense', title='Cost', amount=250, expense_date='2030-01-01')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertEqual(
            (summary['planned'], summary['actual'], summary['remaining'], summary['over_budget'],
             summary['utilization_percent']),
            (1000, 250, 750, False, 25.0),
        )

    def test_over_budget_flag(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._create(kind='budget', title='Small budget', amount=100)
        self._create(kind='expense', title='Overspend', amount=150, expense_date='2030-01-01')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertTrue(summary['over_budget'])
        self.assertEqual(summary['remaining'], -50)

    def test_charter_estimate_reflects_project_budget_state(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertIsNone(self.api('GET', self._url('/summary')).json()['charter_estimate'])
        self.project.write({'nasq_budget_state': 'estimate', 'nasq_budget_amount': 5000})
        self.assertEqual(self.api('GET', self._url('/summary')).json()['charter_estimate'], 5000)

    def test_amount_validation_rejects_bad_values(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        bad_amounts = [True, False, float('nan'), float('inf'), float('-inf'), -1, 1e13, 10.0000001, 'x', None]
        for amount in bad_amounts:
            with self.subTest(amount=amount):
                # Raw JSON exercises the server's non-finite guard: requests'
                # json= parameter rejects NaN/Infinity before sending anything.
                res = self.url_open(
                    self._url(), method='POST', headers={'Content-Type': 'application/json'},
                    data=json.dumps({'kind': 'budget', 'title': 'B', 'amount': amount}),
                )
                self.assertEqual(res.status_code, 422, res.text)
                self.assertEqual(res.json()['field'], 'amount')

    def test_expense_kind_constraints(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', self._url(), {'kind': 'expense', 'title': 'No date', 'amount': 10})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'expense_date'))
        res = self.api('POST', self._url(), {'kind': 'expense', 'title': 'Zero', 'amount': 0, 'expense_date': '2030-01-01'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'amount'))
        res = self.api('POST', self._url(), {
            'kind': 'budget', 'title': 'B', 'amount': 10, 'expense_date': '2030-01-01',
        })
        self.assertEqual((res.status_code, res.json()['field']), (422, 'expense_date'))
        budget = self._create(kind='budget', title='B2', amount=10)
        res = self.api('POST', self._url(), {
            'kind': 'budget', 'title': 'B3', 'amount': 10, 'budget_entry_id': budget['id'],
        })
        self.assertEqual((res.status_code, res.json()['field']), (422, 'budget_entry_id'))

    def test_budget_link_scoped_and_kind_consistent(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='B', amount=100)
        expense = self._create(kind='expense', title='E', amount=10, expense_date='2030-01-01')
        # Link to a non-budget entry.
        res = self.api('POST', self._url(), {
            'kind': 'expense', 'title': 'Bad link', 'amount': 5, 'expense_date': '2030-01-01',
            'budget_entry_id': expense['id'],
        })
        self.assertEqual((res.status_code, res.json()['field']), (422, 'budget_entry_id'))
        # Link to a budget entry from another project.
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Other project'})
        foreign_budget = self.env['nasq.project.finance.entry'].create({
            'project_id': other.id, 'kind': 'budget', 'title': 'Foreign budget', 'amount': 100,
        })
        res = self.api('POST', self._url(), {
            'kind': 'expense', 'title': 'Cross project', 'amount': 5, 'expense_date': '2030-01-01',
            'budget_entry_id': foreign_budget.id,
        })
        self.assertEqual((res.status_code, res.json()['field']), (422, 'budget_entry_id'))
        # A valid same-project link succeeds.
        res = self.api('POST', self._url(), {
            'kind': 'expense', 'title': 'Linked', 'amount': 5, 'expense_date': '2030-01-01',
            'budget_entry_id': budget['id'],
        })
        self.assertEqual(res.status_code, 201, res.text)

    def test_delete_budget_with_linked_expenses_conflicts(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='B', amount=100)
        expense = self._create(
            kind='expense', title='E', amount=10, expense_date='2030-01-01', budget_entry_id=budget['id'],
        )
        res = self.api('DELETE', self._url(f"/{budget['id']}"), {'expected_updated_at': budget['updated_at']})
        self.assertEqual((res.status_code, res.json()['code']), (409, 'finance_entry_linked'))
        # Deleting the expense first frees the budget for deletion.
        res = self.api('DELETE', self._url(f"/{expense['id']}"), {'expected_updated_at': expense['updated_at']})
        self.assertEqual(res.status_code, 200, res.text)
        res = self.api('DELETE', self._url(f"/{budget['id']}"), {'expected_updated_at': budget['updated_at']})
        self.assertEqual(res.status_code, 200, res.text)

    def test_stale_write_conflicts(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='B', amount=100)
        res = self.api('PATCH', self._url(f"/{budget['id']}"), {'amount': 200, 'expected_updated_at': 'v99'})
        self.assertEqual((res.status_code, res.json()['code']), (409, 'stale_write'))
        res = self.api('DELETE', self._url(f"/{budget['id']}"), {'expected_updated_at': 'v99'})
        self.assertEqual((res.status_code, res.json()['code']), (409, 'stale_write'))
        res = self.api('PATCH', self._url(f"/{budget['id']}"), {'expected_updated_at': 'not-a-token'})
        self.assertEqual(res.status_code, 422)

    def test_patch_rejects_kind_and_project_id_and_requires_field(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='B', amount=100)
        res = self.api('PATCH', self._url(f"/{budget['id']}"), {'kind': 'expense', 'expected_updated_at': budget['updated_at']})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'kind'))
        res = self.api('PATCH', self._url(f"/{budget['id']}"), {'expected_updated_at': budget['updated_at']})
        self.assertEqual(res.status_code, 422)

    def test_unsupported_filters_and_kind_query(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', self._url('?bogus=1')).status_code, 400)
        self.assertEqual(self.api('GET', self._url('?kind=nope')).status_code, 422)
        self.assertEqual(self.api('GET', self._url('?limit=0')).status_code, 422)
        self.assertEqual(self.api('GET', self._url('?limit=201')).status_code, 422)

    def test_kind_filter_and_pagination_independent_of_summary(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._create(kind='budget', title='B', amount=1000)
        self._create(kind='expense', title='E1', amount=10, expense_date='2030-01-01')
        self._create(kind='expense', title='E2', amount=20, expense_date='2030-01-02')
        budgets_only = self.api('GET', self._url('?kind=budget')).json()
        self.assertEqual(budgets_only['total'], 1)
        self.assertEqual(budgets_only['summary']['expense_count'], 2)
        page = self.api('GET', self._url('?limit=1&offset=1')).json()
        self.assertEqual(len(page['items']), 1)
        self.assertEqual(page['total'], 3)
        self.assertEqual(page['summary']['actual'], 30)

    def test_archived_project_finance_is_404(self):
        self.project.with_user(self.manager)._nasq_archive()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', self._url()).status_code, 404)
        self.assertEqual(self.api('GET', self._url('/summary')).status_code, 404)
        self.assertEqual(
            self.api('POST', self._url(), {'kind': 'budget', 'title': 'B', 'amount': 1}).status_code, 404,
        )

    def test_private_followers_project_is_hidden(self):
        private = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Private', 'privacy_visibility': 'followers'})
        self.env['nasq.project.finance.entry'].create({
            'project_id': private.id, 'kind': 'budget', 'title': 'Hidden budget', 'amount': 1,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/projects/{private.id}/finance')
        self.assertEqual(res.status_code, 403)

    def test_cross_company_project_is_hidden(self):
        company_b = self.env['res.company'].create({'name': 'Finance company B'})
        foreign = self.env['project.project'].create({'name': 'Foreign', 'company_id': company_b.id})
        self.env['nasq.project.finance.entry'].with_company(company_b).create({
            'project_id': foreign.id, 'kind': 'budget', 'title': 'Foreign budget', 'amount': 1,
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('GET', f'/api/v1/projects/{foreign.id}/finance')
        self.assertEqual(res.status_code, 403)

    def test_foreign_entry_id_in_url_is_404(self):
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Other'})
        foreign_entry = self.env['nasq.project.finance.entry'].create({
            'project_id': other.id, 'kind': 'budget', 'title': 'Foreign', 'amount': 1,
        })
        private = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Private', 'privacy_visibility': 'followers'})
        hidden_entry = self.env['nasq.project.finance.entry'].create({
            'project_id': private.id, 'kind': 'budget', 'title': 'Hidden', 'amount': 1,
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', self._url(f"/{foreign_entry.id}")).status_code, 404)
        self.assertEqual(self.api('GET', self._url(f"/{hidden_entry.id}")).status_code, 404)
        self.assertEqual(self.api('GET', self._url('/999999')).status_code, 404)

    def test_revoked_capability_gets_403_over_direct_rpc(self):
        stranger = new_test_user(
            self.env, login='api_stranger', password='api_stranger_pass_123', name='Omar', groups='base.group_user',
        )
        self.env['nasq.project.finance.entry'].create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        Entry = self.env['nasq.project.finance.entry'].with_user(stranger)
        with self.assertRaises(AccessError):
            Entry.search([('project_id', '=', self.project.id)])
        self.authenticate('api_stranger', 'api_stranger_pass_123')
        self.assertEqual(self.api('GET', self._url()).status_code, 403)

    def test_direct_orm_paths_are_restricted(self):
        Entry = self.env['nasq.project.finance.entry']
        # An employee without manage capability cannot create, write or unlink.
        with self.assertRaises(AccessError):
            Entry.with_user(self.employee).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
            })
        entry = Entry.with_user(self.manager).create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        with self.assertRaises(AccessError):
            entry.with_user(self.employee).write({'amount': 2})
        with self.assertRaises(AccessError):
            entry.with_user(self.employee).unlink()
        # Identity fields cannot be changed even by a manager.
        with self.assertRaises(AccessError):
            entry.with_user(self.manager).write({'kind': 'expense'})
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Other'})
        with self.assertRaises(AccessError):
            entry.with_user(self.manager).write({'project_id': other.id})
        # A bogus amount is rejected at the model layer too, not just the API.
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': True,
            })

    # --- context-default injection and stricter direct-ORM validation -------

    def test_context_default_cannot_inject_revision_company_or_foreign_budget(self):
        Entry = self.env['nasq.project.finance.entry']
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).with_context(default_nasq_revision=999).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
            })
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).with_context(default_company_id=self.project.company_id.id).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
            })
        other = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Other for defaults'})
        foreign_budget = Entry.create({
            'project_id': other.id, 'kind': 'budget', 'title': 'Foreign', 'amount': 5,
        })
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).with_context(default_budget_entry_id=foreign_budget.id).create({
                'project_id': self.project.id, 'kind': 'expense', 'title': 'E', 'amount': 1,
                'expense_date': '2030-01-01',
            })
        # A normal create (no context defaults at all) still succeeds.
        entry = Entry.with_user(self.manager).create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        self.assertEqual(entry.nasq_revision, 1)

    def test_direct_orm_rejects_bad_id_types(self):
        Entry = self.env['nasq.project.finance.entry']
        for bad_project_id in (True, False, 1.5, '1', -1, 0, None):
            with self.subTest(project_id=bad_project_id):
                with self.assertRaises(ValidationError):
                    Entry.with_user(self.manager).create({
                        'project_id': bad_project_id, 'kind': 'budget', 'title': 'B', 'amount': 1,
                    })
        for bad_budget_id in (True, 1.5, '1'):
            with self.subTest(budget_entry_id=bad_budget_id):
                with self.assertRaises(ValidationError):
                    Entry.with_user(self.manager).create({
                        'project_id': self.project.id, 'kind': 'expense', 'title': 'E', 'amount': 1,
                        'expense_date': '2030-01-01', 'budget_entry_id': bad_budget_id,
                    })

    def test_direct_orm_rejects_malformed_dates(self):
        Entry = self.env['nasq.project.finance.entry']
        for bad_date in ('2030-02-30', '2030-01', '13/01/2030', 12345):
            with self.subTest(expense_date=bad_date):
                with self.assertRaises(ValidationError):
                    Entry.with_user(self.manager).create({
                        'project_id': self.project.id, 'kind': 'expense', 'title': 'E', 'amount': 1,
                        'expense_date': bad_date,
                    })

    def test_direct_orm_and_api_enforce_title_reference_notes_limits(self):
        Entry = self.env['nasq.project.finance.entry']
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': '   ', 'amount': 1,
            })
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'x' * 201, 'amount': 1,
            })
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
                'reference': 'x' * 201,
            })
        with self.assertRaises(ValidationError):
            Entry.with_user(self.manager).create({
                'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
                'notes': 'x' * 10001,
            })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': '   ', 'amount': 1})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'title'))
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'x' * 201, 'amount': 1})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'title'))
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'B', 'amount': 1, 'reference': 'x' * 201})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'reference'))
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'B', 'amount': 1, 'notes': 'x' * 10001})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'notes'))

    # --- live _search/_check_access must not leak archived/private rows -----

    def test_search_excludes_archived_project_even_with_active_test_false(self):
        Entry = self.env['nasq.project.finance.entry']
        entry = Entry.with_user(self.manager).create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        self.project.with_user(self.manager)._nasq_archive()
        scoped = Entry.with_user(self.manager).with_context(active_test=False)
        self.assertFalse(scoped.search([('id', '=', entry.id)]))
        self.assertNotIn(entry.id, scoped.search([]).ids)

    def test_search_excludes_unreadable_project_on_domainless_and_name_search(self):
        private = self.env['project.project'].create({'company_id': self.env.company.id, 'name': 'Private for search', 'privacy_visibility': 'followers'})
        hidden = self.env['nasq.project.finance.entry'].create({
            'project_id': private.id, 'kind': 'budget', 'title': 'HiddenViaSearch', 'amount': 1,
        })
        Entry = self.env['nasq.project.finance.entry'].with_user(self.employee)
        self.assertNotIn(hidden.id, Entry.search([]).ids)
        self.assertEqual(Entry.search_count([]), 0)
        self.assertEqual(Entry.name_search('HiddenViaSearch'), [])

    def test_check_access_denies_after_project_archived_for_a_prefetched_record(self):
        entry = self.env['nasq.project.finance.entry'].with_user(self.manager).create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        cached = self.env['nasq.project.finance.entry'].with_user(self.manager).browse(entry.id)
        cached.read(['title', 'amount'])  # populate the record cache before revoking access
        self.project.with_user(self.manager)._nasq_archive()
        self.assertFalse(cached.has_access('read'))
        with self.assertRaises(AccessError):
            cached.check_access('read')

    def test_check_access_denies_when_capability_revoked(self):
        entry = self.env['nasq.project.finance.entry'].with_user(self.manager).create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
        })
        stranger = new_test_user(
            self.env, login='api_stranger2', password='api_stranger2_pass_123', name='Lina', groups='base.group_user',
        )
        as_stranger = entry.with_user(stranger)
        self.assertFalse(as_stranger.has_access('read'))
        with self.assertRaises(AccessError):
            as_stranger.check_access('read')

    # --- finance is strictly current-company; no company-less compatibility -

    def test_companyless_project_finance_is_blocked(self):
        companyless = self.env['project.project'].create({'name': 'Companyless finance project', 'company_id': False})
        self.assertFalse(companyless.company_id)
        with self.assertRaises(AccessError):
            self.env['nasq.project.finance.entry'].with_user(self.manager).create({
                'project_id': companyless.id, 'kind': 'budget', 'title': 'B', 'amount': 1,
            })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('GET', f'/api/v1/projects/{companyless.id}/finance')
        self.assertEqual(res.status_code, 404)

    def test_summary_currency_is_never_null(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertIsNotNone(summary['currency'])
        self.assertEqual(set(summary['currency']), {'id', 'name', 'symbol', 'decimal_places'})

    # --- exact decimal aggregation, not float epsilon ------------------------

    def test_budget_030_expenses_010_and_020_no_float_drift(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._create(kind='budget', title='Small budget', amount=0.30)
        self._create(kind='expense', title='First', amount=0.10, expense_date='2030-01-01')
        self._create(kind='expense', title='Second', amount=0.20, expense_date='2030-01-02')
        summary = self.api('GET', self._url('/summary')).json()
        self.assertEqual(
            (summary['planned'], summary['actual'], summary['remaining'], summary['over_budget'],
             summary['utilization_percent']),
            (0.30, 0.30, 0.0, False, 100.0),
        )

    def test_tiny_subcent_amount_rejected_unless_exact_at_currency_precision(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'Subcent', 'amount': 0.0000001})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'amount'))
        decimals = self.project.currency_id.decimal_places or 2
        exact = round(1 / (10 ** decimals), decimals)
        res = self.api('POST', self._url(), {'kind': 'budget', 'title': 'Exact', 'amount': exact})
        self.assertEqual(res.status_code, 201, res.text)

    # --- system_admin has no implicit PMO write ------------------------------

    def test_system_admin_role_cannot_mutate_finance(self):
        # A system_admin who *also* holds pmo.projects.read (e.g. a legacy
        # employee) can see the project but must still not implicitly get PMO
        # write from the system_admin role - system_admin only manages
        # access/settings (see CLAUDE.md).
        admin = new_test_user(
            self.env, login='finance_system_admin', password='finance_system_admin_pass_123',
            name='Amina', groups='base.group_user',
        )
        Assignment = self.env['nasq.access.assignment']
        Assignment.create({
            'user_id': admin.id, 'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.env.company.id,
        })
        reader_role = self.env['nasq.access.role'].create({
            'name_ar': 'قارئ المشاريع لهذا الاختبار',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        Assignment.create({
            'user_id': admin.id, 'role_id': reader_role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('finance_system_admin', 'finance_system_admin_pass_123')
        self.assertEqual(self.api('GET', self._url()).status_code, 200)
        self.assertEqual(
            self.api('POST', self._url(), {'kind': 'budget', 'title': 'B', 'amount': 1}).status_code, 403,
        )

    def test_vendor_admin_without_pmo_read_cannot_read_finance(self):
        admin = new_test_user(
            self.env, login='finance_vendor_admin', password='finance_vendor_admin_test',
            groups='base.group_system',
        )
        admin.write({'nasq_access_managed': True})
        self.assertFalse(self.env['nasq.access.service']._nasq_has_capability(admin, 'pmo.projects.read'))
        entry = self.env['nasq.project.finance.entry'].create({
            'project_id': self.project.id, 'kind': 'budget', 'title': 'Confidential', 'amount': 100,
        })
        Entry = self.env['nasq.project.finance.entry'].with_user(admin)
        self.assertFalse(Entry.env.su)
        for operation in [
            lambda: Entry.search([]), lambda: Entry.search_count([]),
            lambda: Entry.browse(entry.id).read(['title', 'amount']),
            lambda: Entry.check_access('read'),
        ]:
            with self.subTest(operation=operation), self.assertRaises(AccessError):
                operation()
        self.authenticate('finance_vendor_admin', 'finance_vendor_admin_test')
        for suffix in ['', '/summary', f'/{entry.id}']:
            self.assertEqual(self.api('GET', self._url(suffix)).status_code, 403)

    def test_currency_increment_does_not_silently_round_accepted_amounts(self):
        self.project.currency_id.rounding = 0.05
        self.assertEqual(self.project.currency_id.decimal_places, 2)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        budget = self._create(kind='budget', title='Exact cents', amount=0.12)
        self.assertEqual(budget['amount'], 0.12)
        current = self.api('GET', self._url(f"/{budget['id']}")).json()
        self.assertEqual(current['amount'], 0.12)
        entry = self.env['nasq.project.finance.entry'].browse(budget['id']).with_user(self.manager)
        entry.write({'amount': 0.13})
        entry.flush_recordset()
        entry.invalidate_recordset()
        self.assertEqual(entry.amount, 0.13)
        self.assertEqual(self.api('GET', self._url('/summary')).json()['planned'], 0.13)

    def _create(self, **fields):
        payload = {'reference': '', 'notes': '', **fields}
        res = self.api('POST', self._url(), payload)
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()
