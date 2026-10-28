# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The follow-up engine (spec "Follow-up engine"): recorded calls, scheduling, exhaustion, recycle.

Every time is passed in as ``now`` (default: the database clock), so tests set it explicitly.
Settings changes apply to future scheduling only: nothing here rewrites a time already stored.
"""
import logging
from contextlib import contextmanager
from datetime import timedelta

from odoo import api, fields, models

from odoo.addons.webvue_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)
WORK_CAPABILITY = 'crm.leads.work'
OPEN_DOMAIN = [('active', '=', True), ('type', '=', 'opportunity')]


class WebVueCrmFollowup(models.AbstractModel):
    _name = 'webvue.crm.followup'
    _description = 'WebVue CRM follow-up engine'

    @api.model
    def _webvue_record_call(self, lead, outcome, note=None, duration=None, now=None, sale=None, lost_reason=None):
        """Log a call on ``lead`` and apply its outcome; return the ``crm.phonecall``.

        ``sale`` (``package``, ``final_price``, ``discount_percent``, ``user``) is required by a
        ``won`` outcome. ``lost_reason`` closes a ``lost`` outcome with that reason instead of the outcome's own.
        ``duration`` is in minutes.
        """
        now = now or fields.Datetime.now()
        lead._webvue_require_open()
        if outcome.effect == 'won':
            if not sale:
                raise ApiError(422, 'invalid', 'a sold outcome needs a package and a final price', field='package_id')
            lead._webvue_mark_won(sale['package'], sale['final_price'], sale['discount_percent'], sale['user'])
        elif outcome.effect == 'lost':
            lead._webvue_close_lost(lost_reason or outcome.lost_reason_id)
        elif outcome.effect == 'follow_up':
            self._webvue_schedule(lead, now)
        return self._webvue_log_call(lead, outcome, note, duration, now)

    @api.model
    def _webvue_log_call(self, lead, outcome, note, duration, now):
        return self.env['crm.phonecall'].with_context(mail_create_nolog=True, mail_create_nosubscribe=True).create({
            'name': outcome.name,
            'opportunity_id': lead.id,
            'company_id': lead.company_id.id,
            'team_id': lead.team_id.id,
            'partner_id': lead.partner_id.id,
            'partner_phone': lead.phone,
            'user_id': self.env.uid,
            'description': note or False,
            'duration': duration or 0.0,
            'date': now,
            'date_closed': now,
            'state': 'done',
            'webvue_outcome_id': outcome.id,
        })

    @api.model
    def _webvue_schedule(self, lead, now):
        """A follow-up outcome: count the attempt and schedule the next call, or exhaust (steps 3)."""
        settings = self.env['webvue.crm.settings'].with_company(lead.company_id)._webvue_effective()
        if not settings['followup_attempts']:
            return
        attempts = lead.webvue_attempt_count + 1
        if attempts <= settings['followup_attempts']:
            lead.write({
                'webvue_attempt_count': attempts,
                'webvue_next_call_at': now + timedelta(hours=settings['followup_interval_hours']),
            })
        elif settings['after_attempts'] == 'manager':
            newly_flagged = not lead.webvue_needs_manager
            lead.write({'webvue_attempt_count': attempts, 'webvue_next_call_at': False, 'webvue_needs_manager': True})
            if newly_flagged:
                lead._webvue_notify_managers()
        else:
            lead.write({'webvue_attempt_count': attempts})
            lead._webvue_close_lost(self.env.ref('webvue_crm.lost_reason_attempts_exhausted'))
            if settings['recycle_enabled'] and lead.webvue_cycle < settings['recycle_cycles']:
                lead.webvue_recycle_at = now + timedelta(days=settings['recycle_after_days'])

    @contextmanager
    def _webvue_isolated(self, what):
        """Run a step in its own savepoint; a failure is logged with its traceback and the tick goes on."""
        try:
            with self.env.cr.savepoint():
                yield
        except Exception:
            _logger.exception('webvue_crm follow-up tick failed for %s', what)

    @api.model
    def _webvue_cron_tick(self, now=None):
        """Reopen due recycles, release due follow-ups of agents who can no longer work, ring the bell.

        Runs as the cron superuser, company by company, whatever company the environment holds.
        A failing company or opportunity is rolled back and logged; the others still run.
        """
        now = now or fields.Datetime.now()
        for company in self.env['res.company'].search([]):
            scoped = self.with_company(company)
            with scoped._webvue_isolated(f'company {company.id}'):
                scoped._webvue_reopen_due_recycles(company, now)
                scoped._webvue_release_due_follow_ups(company, now)
                scoped._webvue_ring_due_follow_ups(company, now)

    @api.model
    def _webvue_reopen_due_recycles(self, company, now):
        leads = self.env['crm.lead'].with_context(active_test=False).search([
            ('company_id', '=', company.id), ('type', '=', 'opportunity'), ('active', '=', False),
            ('webvue_recycle_at', '<=', now),
        ])
        for lead in leads.with_context(active_test=True):
            with self._webvue_isolated(f'recycle of opportunity {lead.id}'):
                lead._webvue_restart(cycles=1)

    @api.model
    def _webvue_due_follow_ups(self, company, now):
        return self.env['crm.lead'].search([
            *OPEN_DOMAIN, ('company_id', '=', company.id), ('user_id', '!=', False),
            ('webvue_next_call_at', '<=', now),
        ])

    @api.model
    def _webvue_release_due_follow_ups(self, company, now):
        """A due follow-up whose agent can no longer work goes back to the distribution."""
        service = self.env['webvue.access.service']
        released = self._webvue_due_follow_ups(company, now).filtered(
            lambda lead: not lead.user_id.active or not service._webvue_has_capability(
                lead.user_id, WORK_CAPABILITY, company=company,
            ),
        )
        for lead in released:
            with self._webvue_isolated(f'release of opportunity {lead.id}'):
                lead._webvue_release_agent()
                self.env['webvue.crm.distribution']._webvue_assign(lead)

    @api.model
    def _webvue_ring_due_follow_ups(self, company, now):
        for lead in self._webvue_due_follow_ups(company, now):
            with self._webvue_isolated(f'bell of opportunity {lead.id}'):
                self._webvue_ring(lead)

    @api.model
    def _webvue_ring(self, lead):
        """One ``crm.followup_due`` bell per scheduled time and agent; a rescheduled call rings again."""
        stamp = fields.Datetime.to_string(lead.webvue_next_call_at)
        partner = lead.user_id.partner_id
        self.env['webvue.notify.service']._webvue_deliver(
            'crm.lead', lead.id, 'crm.followup_due', partner, lead.name,
            key=f'crm-followup-due:{lead.id}:{stamp}:{partner.id}',
        )
