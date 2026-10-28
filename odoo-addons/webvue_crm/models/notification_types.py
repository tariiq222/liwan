# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM application's notification kinds in the webvue_notify registry.

No sudo here: a bell row shows only while its opportunity is still readable by the caller, in
the opportunity's own company, under that company's visibility policy. A recipient who lost
``crm.leads.read`` there, or whose opportunity changed hands, sees nothing, whatever rows were
delivered to them.
"""
from odoo import api, models
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso

KINDS = ('crm.assigned', 'crm.followup_due')


def readable_opportunities(env):
    """One subquery per company where the caller reads CRM: its opportunities (lost ones included).

    Each is judged in its own company, by the visibility policy of that company: a bell row
    shows when its opportunity is readable there, whichever company is current. Queries, so the
    bell poll never builds an id list.
    """
    queries = []
    for company in env.user.company_ids:
        Lead = env['crm.lead'].with_company(company).with_context(active_test=False)
        if Lead.has_access('read'):
            domain = env['webvue.crm.visibility'].with_company(company)._webvue_domain(env.user)
            queries.append(Lead._search(domain))
    return queries


class WebVueCrmNotificationTypes(models.AbstractModel):
    _inherit = 'webvue.notify.registry'

    @api.model
    def _webvue_notification_types(self):
        return (
            *super()._webvue_notification_types(),
            *({'kind': kind, 'owner': 'webvue_crm', 'model': 'crm.lead', 'feature_key': 'crm.enabled'} for kind in KINDS),
        )

    @api.model
    def _webvue_notify_visible_domain(self):
        return [
            *super()._webvue_notify_visible_domain(),
            *(
                [
                    ('mail_message_id.webvue_notification_kind', 'in', list(KINDS)),
                    ('mail_message_id.model', '=', 'crm.lead'),
                    ('mail_message_id.res_id', 'in', opportunities),
                ]
                for opportunities in readable_opportunities(self.env)
            ),
        ]

    @api.model
    def _webvue_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.webvue_notification_kind in KINDS:
            return {
                'id': row.id,
                'kind': message.webvue_notification_kind,
                'opportunity_id': message.res_id,
                'title': html2plaintext(message.body).strip(),
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._webvue_notify_dump(row, extra)
