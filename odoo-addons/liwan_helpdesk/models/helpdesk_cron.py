# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Closing the ticket nobody answered: the cron and the bell that tell the owner it happened.

One run per company closes the tickets that have seen no activity for the company's own number of days
and sit in one of the stages it named, measured on the ticket's own activity stamp (``liwan_last_activity_at``)
rather than on the row's last write, which the engine's bookkeeping also moves. A ticket already closed is
never touched, and a run that has nothing to do writes nothing.
"""
from datetime import timedelta

from odoo import api, fields, models

AUTO_CLOSED_KIND = 'helpdesk.auto_closed'
AUTO_CLOSE_FEATURE = 'helpdesk.auto_close'
REQUEST_MODEL = 'helpdesk.ticket'


class LiwanHelpdeskCron(models.AbstractModel):
    _name = 'liwan.helpdesk.cron'
    _description = 'LiwanOS Support Desk scheduled work'
    _liwan_scope = 'global'

    @api.model
    def _liwan_auto_close(self):
        """Close every inactive ticket of every company whose plan and settings ask for it; returns the count.

        A company whose plan does not carry ``helpdesk.auto_close`` keeps its tickets: the switch is read with the
        platform's own reader in that company, never from a cached payload of the cron's own company.
        """
        closed_total = 0
        for company in self.env['res.company'].search([('active', '=', True)]):
            settings = self.env['liwan.helpdesk.settings']._liwan_for(company)
            if not settings.auto_close_days:
                continue
            if not self.env['liwan.entitlement.service'].with_company(company)._liwan_feature_write(
                    AUTO_CLOSE_FEATURE):
                continue
            cutoff = fields.Datetime.now() - timedelta(days=settings.auto_close_days)
            domain = [
                ('company_id', '=', company.id),
                ('stage_id.closed', '=', False),
                ('liwan_last_activity_at', '<', cutoff),
            ]
            if settings.auto_close_stage_ids:
                domain.append(('stage_id', 'in', settings.auto_close_stage_ids.ids))
            tickets = self.env[REQUEST_MODEL].with_company(company).search(domain)
            closed_total += self._liwan_close_batch(tickets)
        return closed_total

    @api.model
    def _liwan_close_batch(self, tickets):
        closed_total = 0
        for ticket in tickets:
            closed_stage = ticket.team_id._get_applicable_stages().filtered(lambda stage: stage.closed)[:1]
            if not closed_stage:
                continue
            ticket.write({'stage_id': closed_stage.id})
            closed_total += 1
            for user in (ticket.user_id | ticket.liwan_requester_user_id):
                if user and user.partner_id:
                    self.env['liwan.notify.service']._liwan_deliver(
                        ticket._name, ticket.id, AUTO_CLOSED_KIND, user.partner_id,
                        self.env._('The inactive ticket %(ticket)s was closed', ticket=ticket.display_name),
                        key='%s:%s:%s' % (AUTO_CLOSED_KIND, ticket.id, user.partner_id.id),
                        values={'subject': ticket.display_name},
                    )
        return closed_total
