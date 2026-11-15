# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the Support Desk holds about one person, and the datasets a tenant takes away.

The engine copies the requester's name and email onto the ticket when a customer is linked, so an
erase clears those copies and keeps the service record: the number, the team, the stages, the SLA
answers and the dates. The export carries the tickets and the settings, never the chatter.
"""
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import model_dataset
from odoo.addons.liwan_customers.models.privacy_hooks import ACTION_ERASE

APP = 'helpdesk'
TICKETS = 'helpdesk_tickets'
TICKET_FIELDS = (
    'id', 'number', 'name', 'company_id', 'team_id', 'stage_id', 'priority', 'partner_id',
    'partner_name', 'partner_email', 'user_id', 'liwan_requester_user_id', 'category_id', 'type_id',
    'channel_id', 'tag_ids', 'last_stage_update', 'assigned_date', 'closed_date', 'liwan_first_response_at',
    'create_date', 'create_uid', 'write_date', 'write_uid',
)
SETTINGS_FIELDS = (
    'id', 'company_id', 'revision', 'preset', 'visibility', 'default_team_id', 'default_priority',
    'reference_prefix', 'reopen_days', 'first_response_hours', 'resolution_hours',
    'create_date', 'create_uid', 'write_date', 'write_uid',
)
# The contact values the ticket keeps next to the link to the party.
PERSONAL_FIELDS = ('partner_name', 'partner_email')
EXPORT_HEADER = (
    'id', 'number', 'subject', 'created', 'closed', 'stage', 'team', 'priority', 'customer_id',
    'requester', 'assignee', 'first_response',
)


def ticket_domain(partners):
    return [('partner_id', 'in', partners.ids)]


class LiwanHelpdeskTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        env = self.env
        return (
            *super()._liwan_export_datasets(),
            model_dataset(env, APP, TICKETS, 'Support tickets', 'helpdesk.ticket', fields=TICKET_FIELDS),
            model_dataset(env, APP, 'helpdesk_settings', 'Support settings', 'liwan.helpdesk.settings',
                          fields=SETTINGS_FIELDS),
        )


class LiwanHelpdeskPrivacyHooks(models.AbstractModel):
    _inherit = 'liwan.customers.privacy.hooks'

    @api.model
    def _liwan_helpdesk_tickets(self, partners):
        """The tickets linked to the parties, closed ones included, as the caller reaches them."""
        if not self.env['liwan.access.service']._liwan_has_capability(
                self.env.user, 'helpdesk.tickets.read', company=self.env.company):
            return self.env['helpdesk.ticket']
        return self.env['helpdesk.ticket'].with_context(active_test=False).search(ticket_domain(partners))

    @api.model
    def _liwan_subject_coverage(self):
        return {
            **super()._liwan_subject_coverage(),
            TICKETS: ('helpdesk.ticket', ticket_domain),
        }

    @api.model
    def _liwan_subject_export(self, partners):
        tickets = self._liwan_helpdesk_tickets(partners)
        return [
            *super()._liwan_subject_export(partners),
            {
                'key': TICKETS, 'title': 'Support tickets', 'header': list(EXPORT_HEADER),
                'rows': [
                    [ticket.id, ticket.number, ticket.name, ticket.create_date, ticket.closed_date,
                     ticket.stage_id.name, ticket.team_id.name, ticket.priority, ticket.partner_id.id,
                     ticket.liwan_requester_user_id.name, ticket.user_id.name, ticket.liwan_first_response_at]
                    for ticket in tickets
                ],
            },
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        return [
            *super()._liwan_subject_erase_preview(partners),
            {'key': TICKETS, 'owner': 'liwan_helpdesk', 'action': ACTION_ERASE,
             'count': len(self._liwan_helpdesk_tickets(partners))},
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        counts = super()._liwan_subject_erase(partners)
        tickets = self._liwan_helpdesk_tickets(partners)
        # No tracking: a tracked write would copy the old values into a new message.
        tickets.with_context(tracking_disable=True).write({name: False for name in PERSONAL_FIELDS})
        return {**counts, TICKETS: len(tickets)}
