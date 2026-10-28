# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM application's notification kinds in the webvue_notify registry.

No sudo here: a bell row shows only while its opportunity is still readable by the caller,
in the current company, under the visibility policy. A recipient who lost ``crm.leads.read``,
or whose opportunity changed hands, sees nothing, whatever rows were delivered to them.
"""
from odoo import api, models
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso

KINDS = ('crm.assigned', 'crm.followup_due')


def readable_opportunities(env):
    """Subquery of the opportunities (lost ones included) the caller reads in the current company.

    A ``Query`` (an empty list without read access), so the bell poll never builds an id list.
    """
    Lead = env['crm.lead'].with_context(active_test=False)
    if not Lead.has_access('read'):
        return []
    return Lead._search(env['webvue.crm.visibility']._webvue_domain(env.user))


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
            [
                ('mail_message_id.webvue_notification_kind', 'in', list(KINDS)),
                ('mail_message_id.model', '=', 'crm.lead'),
                ('mail_message_id.res_id', 'in', readable_opportunities(self.env)),
            ],
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
