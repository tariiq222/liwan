# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .visibility import ASSIGN_CAPABILITY, READ_CAPABILITY
from odoo.addons.liwan_customers.models.privacy_hooks import ACTION_ERASE

# The copy of the person a lead and a call keep next to the link to the customer.
LEAD_PERSONAL_FIELDS = ('partner_name', 'contact_name', 'email_from', 'phone')
CALL_PERSONAL_FIELDS = ('partner_phone', 'email_from')
LEAD_KEY = 'crm_leads'
CALL_KEY = 'crm_calls'


class LiwanCrmPrivacyHooks(models.AbstractModel):
    """What CRM holds about a customer: the opportunities and calls linked to it. Erasing clears the copied name, phone
    and email and keeps the commercial facts (stage, package, prices, outcome) and the link to the customer.

    It runs as the caller, so it reaches the opportunities the visibility policy shows them: a caller who does not hold
    ``crm.leads.assign`` in the company may not reach every opportunity (and one without ``crm.leads.read`` reaches none), and the preview then says ``complete: false``.
    """
    _inherit = 'liwan.customers.privacy.hooks'

    @api.model
    def _liwan_subject_models(self):
        return [*super()._liwan_subject_models(), 'crm.lead', 'crm.phonecall']

    @api.model
    def _liwan_crm_subject(self, partners):
        """``(leads, calls)`` linked to the parties, archived ones included; none for a caller without
        ``crm.leads.read``, who has no ACL on them (the preview then says ``complete: false``)."""
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, READ_CAPABILITY):
            return self.env['crm.lead'], self.env['crm.phonecall']
        leads = self.env['crm.lead'].with_context(active_test=False).search([('partner_id', 'in', partners.ids)])
        calls = self.env['crm.phonecall'].with_context(active_test=False).search(
            ['|', ('partner_id', 'in', partners.ids), ('opportunity_id', 'in', leads.ids)],
        )
        return leads, calls

    @api.model
    def _liwan_subject_export(self, partners):
        leads, calls = self._liwan_crm_subject(partners)
        return [
            *super()._liwan_subject_export(partners),
            {
                'key': LEAD_KEY, 'title': 'CRM opportunities',
                'header': ['id', 'name', 'customer_id', 'partner_name', 'contact_name', 'email', 'phone', 'stage',
                           'active', 'created'],
                'rows': [
                    [lead.id, lead.name, lead.partner_id.id, lead.partner_name, lead.contact_name, lead.email_from,
                     lead.phone, lead.stage_id.name, lead.active, lead.create_date]
                    for lead in leads
                ],
            },
            {
                'key': CALL_KEY, 'title': 'CRM calls',
                'header': ['id', 'summary', 'customer_id', 'opportunity_id', 'phone', 'email', 'date', 'duration',
                           'outcome'],
                'rows': [
                    [call.id, call.name, call.partner_id.id, call.opportunity_id.id, call.partner_phone,
                     call.email_from, call.date, call.duration, call.liwan_outcome_id.name]
                    for call in calls
                ],
            },
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        leads, calls = self._liwan_crm_subject(partners)
        complete = self.env['liwan.access.service']._liwan_has_capability(self.env.user, ASSIGN_CAPABILITY)
        return [
            *super()._liwan_subject_erase_preview(partners),
            {'key': LEAD_KEY, 'owner': 'liwan_crm', 'action': ACTION_ERASE, 'count': len(leads), 'complete': complete},
            {'key': CALL_KEY, 'owner': 'liwan_crm', 'action': ACTION_ERASE, 'count': len(calls), 'complete': complete},
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        counts = super()._liwan_subject_erase(partners)
        leads, calls = self._liwan_crm_subject(partners)
        # No tracking: a tracked write would copy the old values into a new message.
        leads.with_context(tracking_disable=True).write({name: False for name in LEAD_PERSONAL_FIELDS})
        calls.with_context(tracking_disable=True).write({name: False for name in CALL_PERSONAL_FIELDS})
        return {**counts, LEAD_KEY: len(leads), CALL_KEY: len(calls)}
