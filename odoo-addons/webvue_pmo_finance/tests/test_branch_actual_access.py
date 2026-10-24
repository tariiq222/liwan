# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import PmoFinanceCase


@tagged('post_install', '-at_install', 'webvue')
class TestBranchActualAccess(PmoFinanceCase):
    """Project totals do not grant access to a branch's detailed financial lines."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({
            'name': 'Project Finance Branch', 'parent_id': cls.company.id,
        })
        cls.branch_project = cls.env['project.project'].with_company(cls.branch).create({
            'name': 'Branch Project', 'company_id': cls.branch.id,
        })
        cls.branch_center = cls.env['account.analytic.account'].with_company(cls.branch).create({
            'name': 'Private Branch Center', 'plan_id': cls.alpha.plan_id.id,
            'company_id': cls.branch.id, 'webvue_project_id': cls.branch_project.id,
        })
        cls.branch_line = cls.env['account.analytic.line'].with_company(cls.branch).create({
            'name': 'Private branch expense', 'amount': -125,
            cls.alpha.plan_id._column_name(): cls.branch_center.id,
            'company_id': cls.branch.id, 'general_account_id': cls.expense_account.id,
        })
        cls.line_reader.company_ids = [Command.set((cls.company | cls.branch).ids)]
        cls.branch_role = cls.env['webvue.access.role'].with_company(cls.branch)._webvue_access_create({
            'key': 'branch_project_totals', 'name_ar': 'قارئ إجمالي مشروع الفرع',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'finance.invoices.read']),
            ]).ids)],
        })
        cls.env['webvue.access.assignment']._webvue_access_create({
            'user_id': cls.line_reader.id, 'role_id': cls.branch_role.id,
            'company_id': cls.branch.id,
        })

    def test_parent_analytic_permission_does_not_reveal_branch_lines(self):
        self.login_as(self.line_reader)
        summary = self.get_ok(self.summary_url(self.branch_project))
        self.assertEqual((summary['actual'], summary['expense_count']), (125, 1))
        self.assertFalse(summary['can_read_actual_lines'])
        response = self.api('GET', self.lines_url(project=self.branch_project))
        self.assertEqual(response.status_code, 403, response.text)

    def test_direct_source_requires_the_project_company_permission(self):
        source = self.env['webvue.project.actual.source'].with_user(self.line_reader).with_context(
            allowed_company_ids=(self.company | self.branch).ids,
            webvue_capability_scope=((('pmo.projects.read',), 'all'),),
        )
        project = self.branch_project.with_env(source.env)
        with self.assertRaises(AccessError):
            source._webvue_actual_lines(project, 50, 0)

    def test_explicit_branch_analytic_permission_allows_lines(self):
        permission = self.env['webvue.access.permission'].search([('key', '=', 'finance.analytic.read')])
        self.branch_role._webvue_access_write({'permission_ids': [Command.link(permission.id)]})
        self.login_as(self.line_reader)
        summary = self.get_ok(self.summary_url(self.branch_project))
        self.assertTrue(summary['can_read_actual_lines'])
        body = self.get_ok(self.lines_url(project=self.branch_project))
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0]['label'], 'Private branch expense')

    def test_membership_without_branch_project_permission_hides_project(self):
        self.branch_role._webvue_access_write({'permission_ids': [Command.clear()]})
        self.login_as(self.line_reader)
        response = self.api('GET', self.lines_url(project=self.branch_project))
        self.assertEqual(response.status_code, 404, response.text)

    def test_parent_analytic_manager_does_not_choose_a_branch_cost_center(self):
        self.owner.company_ids = [Command.set((self.company | self.branch).ids)]
        self.env['webvue.access.assignment']._webvue_access_create({
            'user_id': self.owner.id, 'role_id': self.branch_role.id,
            'company_id': self.branch.id,
        })
        self.login_as(self.owner)
        summary = self.get_ok(self.summary_url(self.branch_project))
        self.assertFalse(summary['can_choose_actual_account'])
        source = self.env['webvue.project.actual.source'].with_user(self.owner).with_context(
            allowed_company_ids=(self.company | self.branch).ids,
            webvue_capability_scope=((('pmo.projects.read',), 'all'),),
        )
        with self.assertRaises(AccessError):
            source._webvue_set_actual_account(self.branch_project.with_env(source.env), None)
        self.assertEqual(self.branch_center.webvue_project_id, self.branch_project)
