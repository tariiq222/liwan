# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import PmoFinanceCase
from odoo.addons.liwan_finance.tests.write_common import PASSWORD


@tagged('post_install', '-at_install', 'liwan')
class TestAnalyticAccess(PmoFinanceCase):
    """A project reader totals the items of project cost centers without sudo(), and nobody else loses items."""

    def _lines(self, user):
        return self.env['account.analytic.line'].with_user(user).with_company(self.company).search([])

    def test_a_project_reader_sees_only_the_expense_items_of_project_cost_centers(self):
        lines = self._lines(self.reader)
        self.assertTrue(lines)
        self.assertEqual(set(self.cost_centers_of(lines)), {self.alpha})
        self.assertNotIn(self.sale.line_ids.analytic_line_ids, lines)
        self.assertEqual(set(lines.general_account_id.mapped('internal_group')), {'expense'})

    def test_a_project_reader_cannot_write_items(self):
        lines = self._lines(self.reader)
        with self.assertRaises(AccessError), self.cr.savepoint():
            lines.write({'name': 'Changed'})

    def test_a_finance_reader_who_is_a_project_reader_keeps_every_item(self):
        lines = self._lines(self.line_reader)
        self.assertIn(self.riyadh, self.cost_centers_of(lines))
        self.assertIn(self.alpha, self.cost_centers_of(lines))
        self.login_as(self.line_reader)
        report = self.get_ok('/api/v1/finance/reports/analytic?date_from=2026-10-01&date_to=2026-10-31')
        riyadh = next(row for row in report['accounts'] if row['account']['id'] == self.riyadh.id)
        self.assertEqual(riyadh['expense'], 800)

    def test_the_analytic_and_project_manager_groups_keep_every_item(self):
        for groups in ('analytic.group_analytic_accounting', 'project.group_project_manager'):
            user = new_test_user(
                self.env, login=f'pf_{groups.split(".")[1]}', password=PASSWORD,
                groups=f'liwan_core.group_employee,liwan_pmo.group_cap_pmo_projects_read,{groups}',
                company_id=self.company.id, company_ids=[Command.set(self.company.ids)],
            )
            self.assertIn(self.riyadh, self.cost_centers_of(self._lines(user)), groups)

    def test_every_group_that_reads_items_has_a_rule_of_its_own_or_is_the_project_reader(self):
        # Group rules of one model are ORed per user: a group with a read ACL but no rule would silently lose
        # every item for a user who also holds the project reader rule.
        Model = self.env['ir.model.access'].sudo()
        groups = Model.search([
            ('model_id.model', '=', 'account.analytic.line'), ('perm_read', '=', True), ('group_id', '!=', False),
        ]).group_id
        ruled = self.env['ir.rule'].sudo().search([('model_id.model', '=', 'account.analytic.line')]).groups
        reader = self.env.ref('liwan_pmo.group_cap_pmo_projects_read')
        unruled = groups.filtered(lambda group: group != reader and not (group.all_implied_ids & ruled))
        self.assertFalse(unruled, unruled.mapped('full_name'))
