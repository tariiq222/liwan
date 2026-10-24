# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The actual cost of a project: the posted expense of its cost center (an analytic account).

Everything runs in the caller's own environment, with no ``sudo()``: the bridge's ACLs and record rule
(``security/``) let a project reader total the items of project cost centers, and the finance capabilities
(``finance.analytic.read``, ``finance.analytic.manage``) gate the lines and the choice of the cost center.
While ``finance.enabled`` is readable every project is external, whether or not a cost center is linked yet;
otherwise every hook answers "manual".
"""
from collections import defaultdict
from decimal import Decimal

from odoo import api, models
from odoo.exceptions import MissingError

from .project_project import FINANCE_FEATURE
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_pmo.serializers.project_finance import to_decimal
from odoo.addons.webvue_pmo_finance.serializers.actual_line import dump_actual_line

READ_CAPABILITY = 'finance.analytic.read'
MANAGE_CAPABILITY = 'finance.analytic.manage'
# Only items on expense accounts are a cost; revenue and balance sheet items are not (see webvue.finance.analytic.report).
EXPENSE_GROUP = 'expense'


class WebVueProjectActualSource(models.AbstractModel):
    _inherit = 'webvue.project.actual.source'

    @api.model
    def _webvue_cost_center(self, project):
        """The cost center of ``project`` while finance is readable, else an empty recordset."""
        if not self.env['webvue.entitlement.service']._webvue_feature_read(FINANCE_FEATURE):
            return self.env['account.analytic.account']
        return project.webvue_cost_center_ids

    @api.model
    def _webvue_is_external(self, project):
        return self.env['webvue.entitlement.service']._webvue_feature_read(FINANCE_FEATURE)

    @api.model
    def _webvue_has_capability(self, key, project):
        return self.env['webvue.access.service']._webvue_has_capability(self.env.user, key, record=project)

    @api.model
    def _webvue_expense_domain(self, account):
        return [
            (account.plan_id._column_name(), '=', account.id),
            ('company_id', '=', account.company_id.id),
            ('general_account_id.internal_group', '=', EXPENSE_GROUP),
        ]

    @api.model
    def _webvue_actual_totals(self, projects):
        if not self.env['webvue.entitlement.service']._webvue_feature_read(FINANCE_FEATURE):
            return {}
        totals = {project.id: (Decimal(0), 0) for project in projects}
        accounts_by_column = defaultdict(list)
        project_of = {}
        for project in projects:
            for account in project.webvue_cost_center_ids:
                accounts_by_column[account.plan_id._column_name()].append(account)
                project_of[account.id] = project.id
        for column, accounts in accounts_by_column.items():
            domain = [
                (column, 'in', [account.id for account in accounts]),
                ('company_id', 'in', [account.company_id.id for account in accounts]),
                ('general_account_id.internal_group', '=', EXPENSE_GROUP),
            ]
            for account, amount, count in self.env['account.analytic.line']._read_group(
                domain, [column], ['amount:sum', '__count'],
            ):
                totals[project_of[account.id]] = (Decimal(0) - to_decimal(amount), count)
        return totals

    @api.model
    def _webvue_actual_account(self, project):
        account = self._webvue_cost_center(project)
        return {'id': account.id, 'name': account.name, 'code': account.code or None} if account else None

    @api.model
    def _webvue_can_read_actual_lines(self, project):
        return self._webvue_is_external(project) and self._webvue_has_capability(READ_CAPABILITY, project)

    @api.model
    def _webvue_actual_lines(self, project, limit, offset):
        self.env['webvue.access.service']._webvue_require_capability(READ_CAPABILITY, record=project)
        if not self._webvue_is_external(project):
            raise MissingError(self.env._("This project has no external actual cost."))
        account = self._webvue_cost_center(project)
        if not account:
            return [], 0
        Line = self.env['account.analytic.line']
        domain = self._webvue_expense_domain(account)
        lines = Line.search(domain, order='date desc, id desc', limit=limit, offset=offset)
        return [dump_actual_line(line) for line in lines], Line.search_count(domain)

    @api.model
    def _webvue_can_choose_actual_account(self, project):
        return (
            self.env['webvue.entitlement.service']._webvue_feature_write(FINANCE_FEATURE)
            and self._webvue_has_capability(MANAGE_CAPABILITY, project)
        )

    @api.model
    def _webvue_set_actual_account(self, project, account_id):
        if not self.env['webvue.entitlement.service']._webvue_feature_write(FINANCE_FEATURE):
            raise MissingError(self.env._("This project has no external actual cost."))
        self.env['webvue.access.service']._webvue_require_capability(MANAGE_CAPABILITY, record=project)
        current = project.webvue_cost_center_ids
        if account_id is None:
            current.webvue_project_id = False
            return
        account = self.env['account.analytic.account'].search([
            ('id', '=', account_id), ('company_id', '=', project.company_id.id),
        ])
        if not account:
            raise ApiError(422, 'invalid', "account_id must be a cost center of the current company", field='account_id')
        if account.webvue_project_id and account.webvue_project_id != project:
            raise ApiError(409, 'account_linked', "the cost center is already linked to another project", field='account_id')
        (current - account).webvue_project_id = False
        # The unique link is checked per statement: the old cost center must be released first.
        current.flush_recordset(['webvue_project_id'])
        account.webvue_project_id = project
