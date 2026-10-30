# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The state changes of an opportunity: sale, loss, reopening, reassignment and the bell.

Every method taking a ``user`` judges that actor: only the agent of the opportunity, or a
holder of ``crm.leads.assign``, may change it. Writes that assign an agent never send the
stock assignment mail (``mail_auto_subscribe_no_notify``): LiwanOS tells the agent through
the bell instead.
"""
from odoo import models

from .visibility import ASSIGN_CAPABILITY
from odoo.addons.liwan_api.controllers.common import ApiError

APPROVE_DISCOUNT = 'crm.discount.approve'
CLEARED_FOLLOW_UP = {'liwan_next_call_at': False, 'liwan_needs_manager': False}


class CrmLeadFlow(models.Model):
    _inherit = 'crm.lead'

    def _liwan_visibility(self):
        return self.env['liwan.crm.visibility']

    def _liwan_require_open(self):
        """409 unless the opportunity is still pending (neither won nor lost)."""
        if not self.active or self.won_status != 'pending':
            raise ApiError(409, 'conflict', 'the opportunity is closed')

    def _liwan_require_assigner(self, user):
        if not self._liwan_visibility()._liwan_can_assign(user, self.company_id):
            raise ApiError(403, 'forbidden', f'{ASSIGN_CAPABILITY} capability is required')

    def _liwan_discount(self, package, final_price, declared_percent, user):
        """The discount the sale grants, derived from the prices alone, after the company's policy.

        A declared percentage must equal it (rounded to two decimals): the stored discount is one
        fact, the difference between the package price and the final price. ``None`` declares nothing.
        """
        discount = round((package.list_price - final_price) * 100 / package.list_price, 2) if (
            final_price < package.list_price
        ) else 0
        if declared_percent is not None and round(declared_percent, 2) != discount:
            raise ApiError(422, 'invalid', 'the discount does not match the prices', field='discount_percent')
        if final_price > package.list_price:
            self._liwan_check_price_above_list(user)
        if not discount:
            return 0
        settings = self.env['liwan.crm.settings'].with_company(self.company_id)._liwan_effective()
        if not settings['discount_allowed']:
            raise ApiError(422, 'invalid', 'discounts are not allowed', field='discount_percent')
        if discount > settings['discount_max_percent'] and not self.env['liwan.access.service']._liwan_has_capability(
            user, APPROVE_DISCOUNT, company=self.company_id,
        ):
            raise ApiError(403, 'forbidden', f'{APPROVE_DISCOUNT} capability is required')
        return discount

    def _liwan_check_price_above_list(self, user):
        """A sale above the package price follows the company's policy: refused, a manager decision, or open."""
        policy = self.env['liwan.crm.settings'].with_company(self.company_id)._liwan_effective()['price_above_list']
        if policy == 'forbid' or (policy == 'managers' and not self.env['liwan.access.service']._liwan_has_capability(
            user, APPROVE_DISCOUNT, company=self.company_id,
        )):
            raise ApiError(
                422, 'invalid', 'the final price is above the package price', field='final_price',
                details={'reason': f'crm_price_above_list_{policy}'},
            )

    def _liwan_mark_won(self, package, final_price, discount_percent, user):
        """Sell ``package`` at ``final_price``: won stage, prices set, follow-up cleared."""
        self.ensure_one()
        self._liwan_visibility()._liwan_check_write(self, user)
        self._liwan_require_open()
        discount = self._liwan_discount(package, final_price, discount_percent, user)
        self.write({
            'liwan_package_id': package.id,
            'liwan_list_price': package.list_price,
            'liwan_discount_percent': discount,
            'liwan_final_price': final_price,
            'liwan_recycle_at': False,
            **CLEARED_FOLLOW_UP,
        })
        self.action_set_won()

    def _liwan_close_lost(self, reason):
        """Close as lost with ``reason`` (may be empty), clearing the pending follow-up."""
        self.ensure_one()
        self._liwan_require_open()
        self.write({'liwan_recycle_at': False, **CLEARED_FOLLOW_UP})
        self.action_set_lost(lost_reason_id=reason.id)

    def _liwan_mark_lost(self, reason, user):
        self.ensure_one()
        self._liwan_visibility()._liwan_check_write(self, user)
        self._liwan_close_lost(reason)

    def _liwan_release_agent(self):
        """Take the opportunities back from their agents, to the pool until the distribution assigns them.

        The company is written with the agent: stock blanks the company of an opportunity left
        without an assignee when its team has no company, or when it has no team and no partner of
        that company.
        """
        for lead in self.with_context(mail_auto_subscribe_no_notify=True):
            lead.write({'user_id': False, 'company_id': lead.company_id.id})

    def _liwan_first_stage(self):
        """The stage a restarted opportunity starts in: the seeded "new" stage while active, else the
        first open (not won) stage by sequence."""
        new = self.env.ref('liwan_crm.stage_new', raise_if_not_found=False)
        if new and new.active and not new.is_won:
            return new
        return self.env['crm.stage'].search([('is_won', '=', False)], limit=1)

    def _liwan_restart(self, cycles=0):
        """Back to the first stage with a fresh attempt count, for the same agent when still eligible.

        An agent who can no longer take opportunities releases it to the current distribution.
        """
        self.ensure_one()
        agent = self.user_id
        if not self.active:
            self.action_unarchive()
        self.with_context(mail_auto_subscribe_no_notify=True).write({
            'stage_id': self._liwan_first_stage().id,
            'liwan_cycle': self.liwan_cycle + cycles,
            'liwan_attempt_count': 0,
            'liwan_recycle_at': False,
            **CLEARED_FOLLOW_UP,
        })
        distribution = self.env['liwan.crm.distribution']
        if agent in distribution._liwan_eligible_agents(self.company_id):
            self._liwan_notify_assigned()
        else:
            self._liwan_release_agent()
            distribution._liwan_assign(self)

    def _liwan_reopen(self, user):
        """Reopen a lost opportunity, or the cycle of one waiting for a manager's decision."""
        self.ensure_one()
        self._liwan_require_assigner(user)
        if self.won_status == 'won' or (self.active and not self.liwan_needs_manager):
            raise ApiError(409, 'conflict', 'only a lost or flagged opportunity can be reopened')
        self._liwan_restart()

    def _liwan_reassign(self, agent, user):
        """Hand the opportunity to ``agent`` (422 unless eligible) and start its follow-up afresh."""
        self.ensure_one()
        self._liwan_require_assigner(user)
        self._liwan_require_open()
        self.env['liwan.crm.distribution']._liwan_assign(self, mode='on_import', agent=agent)
        self.write({'liwan_attempt_count': 0, **CLEARED_FOLLOW_UP})

    def _liwan_notify_assigned(self):
        """Tell each agent about the opportunities given to them, unless they did it themselves.

        One bell per agent and company, however many opportunities: it opens the first one (lowest id)
        and carries the number of opportunities, which the UI words.
        """
        service = self.env['liwan.notify.service']
        groups = {}
        for lead in self.filtered('user_id').sorted('id'):
            if lead.user_id != self.env.user:
                groups.setdefault((lead.user_id, lead.company_id), []).append(lead)
        for (user, _company), leads in groups.items():
            service._liwan_deliver(
                'crm.lead', leads[0].id, 'crm.assigned', user.partner_id, leads[0].name,
                values={'liwan_crm_count': len(leads)},
            )

    def _liwan_notify_managers(self):
        """Tell the holders of ``crm.leads.assign`` that this opportunity waits for a decision."""
        service = self.env['liwan.notify.service']
        visibility = self._liwan_visibility()
        for lead in self:
            candidates = self.env['res.users'].search([('company_ids', 'in', lead.company_id.id), ('share', '=', False)])
            managers = (candidates - self.env.user).filtered(
                lambda user, company=lead.company_id: visibility._liwan_can_assign(user, company),
            )
            service._liwan_deliver('crm.lead', lead.id, 'crm.needs_manager', managers.partner_id, lead.name)
