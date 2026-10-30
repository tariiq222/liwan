# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from psycopg2 import IntegrityError

from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import PmoFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestActualAccount(PmoFinanceCase):

    def _patch(self, account_id, project=None):
        return self.api('PATCH', self.account_url(project), {'account_id': account_id})

    def _summary_after(self, account_id):
        response = self._patch(account_id)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assertRefusedWith(self, response, status, code, field=None):  # noqa: N802
        self.assertEqual((response.status_code, response.json()['code']), (status, code), response.text)
        if field:
            self.assertEqual(response.json()['field'], field)

    def test_choosing_needs_the_project_manager_and_the_cost_center_capability(self):
        for user in (self.reader, self.line_reader, self.employee):
            self.login_as(user)
            self.assertRefusedWith(self._patch(self.riyadh.id), 403, 'forbidden')
        self.login_as(self.project_manager)
        refused = self._patch(self.riyadh.id)
        self.assertRefusedWith(refused, 403, 'forbidden')
        self.assertIn('finance.analytic.manage', refused.json()['message'])
        self.assertEqual(self.alpha.liwan_project_id, self.project)

    def test_the_account_must_be_a_cost_center_of_the_current_company(self):
        self.login_as(self.owner)
        for account_id in (self.other_branch.id, self.shared.id, 999999):
            self.assertRefusedWith(self._patch(account_id), 422, 'invalid', 'account_id')

    def test_an_account_of_another_project_is_refused(self):
        self.login_as(self.owner)
        self.assertRefusedWith(self._patch(self.beta.id), 409, 'account_linked', 'account_id')
        self.assertEqual(self.beta.liwan_project_id, self.other_project)

    def test_choose_replace_and_unlink(self):
        self.login_as(self.owner)
        summary = self._summary_after(self.riyadh.id)
        self.assertEqual(summary['actual_account'], {'id': self.riyadh.id, 'name': 'Riyadh', 'code': 'RYD'})
        # Riyadh holds its 40% share of the split bill.
        self.assertEqual((summary['actual'], summary['expense_count']), (800, 1))
        self.assertFalse(self.alpha.liwan_project_id)
        self.assertEqual(self.riyadh.liwan_project_id, self.project)
        # Choosing the same account again changes nothing; a project has one cost center.
        self.assertEqual(self._summary_after(self.riyadh.id)['actual_account']['id'], self.riyadh.id)
        back = self._summary_after(self.alpha.id)
        self.assertEqual((back['actual'], back['actual_account']['id']), (2050, self.alpha.id))
        self.assertFalse(self.riyadh.liwan_project_id)
        gone = self._summary_after(None)
        self.assertEqual((gone['actual_source'], gone['actual_account'], gone['actual']), ('external', None, 0))
        self.assertFalse(self.alpha.liwan_project_id)

    def test_the_link_is_unique_and_stays_in_the_company(self):
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.cr.savepoint():
            self.riyadh.liwan_project_id = self.project
        foreign = self.env['project.project'].create({'name': 'Foreign', 'company_id': self.other_company.id})
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.riyadh.liwan_project_id = foreign

    def test_a_deleted_project_releases_its_cost_center(self):
        project = self.env['project.project'].create({'name': 'Short lived', 'company_id': self.company.id})
        self.jeddah.liwan_project_id = project
        project.unlink()
        self.assertFalse(self.jeddah.liwan_project_id)

    def _create_project(self, user):
        return self.env['project.project'].with_user(user).with_company(self.company)._liwan_create_from_policy(
            'Created by policy', user_id=user.id, date_end=date(2031, 1, 1),
        )

    def _centers_of(self, project):
        return self.env['account.analytic.account'].search([('liwan_project_id', '=', project.id)])

    def _set_mode(self, mode, creators='managers'):
        self.company.with_company(self.company)._liwan_write_pmo_settings({
            'liwan_pmo_finance_cost_center_mode': mode,
            'liwan_pmo_settings_initialized': True,
            'liwan_pmo_project_creators': creators,
            'liwan_pmo_default_stages': '[{"name": "New", "fold": false}]',
        })

    def test_manual_mode_creates_no_cost_center(self):
        self._set_mode('manual')
        project = self._create_project(self.pmo_manager)
        self.assertFalse(self._centers_of(project))

    def test_auto_mode_creates_the_cost_center_of_a_project_manager_without_finance_access(self):
        self._set_mode('auto')
        project = self._create_project(self.pmo_manager)
        center = self._centers_of(project)
        project_plan, _other_plans = self.env['account.analytic.plan']._get_all_plans()
        self.assertEqual(
            (center.name, center.code, center.company_id, center.plan_id),
            ('Created by policy', project.liwan_code, self.company, project_plan),
        )
        self.assertEqual(self.get_summary_of(project, self.pmo_manager)['actual_account']['id'], center.id)

    def test_auto_mode_gives_an_employee_creator_no_cost_center(self):
        # The employee creates the project in PMO's elevated policy environment; the cost center is not elevated with it.
        self._set_mode('auto', creators='employees')
        project = self._create_project(self.employee)
        self.assertTrue(project)
        self.assertFalse(self._centers_of(project))

    def test_auto_mode_creates_nothing_while_finance_is_switched_off(self):
        self._set_mode('auto')
        self.switch_finance(False)
        self.assertFalse(self._centers_of(self._create_project(self.pmo_manager)))

    def get_summary_of(self, project, user):
        self.login_as(user)
        return self.get_ok(self.summary_url(project))

    def test_a_copied_project_gets_its_own_cost_center_in_auto_mode(self):
        self._set_mode('auto')
        self.project.write({'date_start': date(2026, 10, 1), 'date': date(2026, 12, 1)})
        copy = self.project.with_user(self.pmo_manager).with_company(self.company)._liwan_copy_structure(
            'Copy', date(2031, 1, 1),
        )
        self.assertEqual(self._centers_of(copy).name, 'Copy')
        self.assertEqual(self._centers_of(self.project), self.alpha)
