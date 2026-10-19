# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError

# Source states each transition accepts: the same matrix as the budget routes.
TRANSITION_SOURCES = {
    'action_confirm': ('draft',),
    'action_cancel': ('draft', 'confirmed'),
    'action_draft': ('confirmed', 'cancelled'),
}


class WebVueFinanceBudgetGuard(models.Model):
    """A budget changes state only along the route matrix, whoever calls the ORM."""
    _inherit = 'mis.budget.by.account'

    def _webvue_check_transition(self, action):
        for budget in self:
            if budget.state not in TRANSITION_SOURCES[action]:
                raise UserError(self.env._('A %(state)s budget cannot be changed this way.', state=budget.state))

    def copy(self, default=None):
        # A copy starts as a draft, otherwise its copied lines would be refused.
        return super().copy({'state': 'draft', **(default or {})})

    def action_confirm(self):
        self._webvue_check_transition('action_confirm')
        return super().action_confirm()

    def action_cancel(self):
        self._webvue_check_transition('action_cancel')
        return super().action_cancel()

    def action_draft(self):
        self._webvue_check_transition('action_draft')
        return super().action_draft()


class WebVueFinanceBudgetItemGuard(models.Model):
    """The lines of a budget are created, changed and removed only while the budget is a draft."""
    _inherit = 'mis.budget.by.account.item'

    def _webvue_require_draft(self, budgets):
        if any(budget.state != 'draft' for budget in budgets):
            raise UserError(self.env._('The lines of a budget can only be changed while it is a draft.'))

    @api.model_create_multi
    def create(self, vals_list):
        budgets = self.env['mis.budget.by.account'].browse([vals['budget_id'] for vals in vals_list if vals.get('budget_id')])
        self._webvue_require_draft(budgets)
        return super().create(vals_list)

    def write(self, vals):
        self._webvue_require_draft(self.budget_id | self.env['mis.budget.by.account'].browse(vals.get('budget_id')))
        return super().write(vals)

    def unlink(self):
        self._webvue_require_draft(self.budget_id)
        return super().unlink()
