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
from odoo.addons.webvue_crm.models.crm_settings import TERM_MEMO
from odoo.addons.webvue_crm.serializers.settings import dump_terms

KINDS = ('crm.assigned', 'crm.followup_due', 'crm.needs_manager')


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
                'count': message.webvue_crm_count,
                'term': self._webvue_crm_term(message),
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._webvue_notify_dump(row, extra)

    @api.model
    def _webvue_crm_term(self, message):
        """The word for an opportunity as its own company calls it, in both languages, so the UI words the title.

        The caller reads the opportunity in one of their companies (the visibility branch), so the settings of that
        company are read in the caller's environment, as the ``/crm/terms`` route does. Computed once per company in a
        transaction (the settings model drops the memo when it changes). With no readable company the current one answers.
        """
        company = self.env['res.company']
        for candidate in self.env.user.company_ids:
            lead = self.env['crm.lead'].with_company(candidate).with_context(active_test=False).browse(message.res_id)
            if lead.has_access('read'):
                company = lead.company_id
                break
        company = company or self.env.company
        memo = self.env.cr.cache.setdefault(TERM_MEMO, {})
        if company.id not in memo:
            effective = self.env['webvue.crm.settings'].with_company(company)._webvue_effective()
            memo[company.id] = dump_terms(effective)['opportunity']
        return memo[company.id]
