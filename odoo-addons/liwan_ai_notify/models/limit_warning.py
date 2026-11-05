# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell row a tenant's AI settings managers get once a month per limit, when usage reaches 80% of it.

No sudo: the sender's message audit delivers it in the sender's environment, and a row shows only to a user
who still holds ``ai.settings.manage``.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'ai.limit_warning'
SETTINGS_MODEL = 'liwan.ai.settings'
WARNING_RATIO = 0.8
BODIES = {
    'messages': 'وصل استخدام رسائل الذكاء الاصطناعي هذا الشهر إلى 80% من الحد.',
    'tokens': 'وصل استخدام وحدات (tokens) الذكاء الاصطناعي هذا الشهر إلى 80% من الحد.',
}


class LiwanAiLimitMessage(models.Model):
    _inherit = 'mail.message'

    liwan_notification_kind = fields.Selection(
        selection_add=[(KIND, 'AI limit warning')], ondelete={KIND: 'cascade'},
    )


class LiwanAiLimitTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            {'kind': KIND, 'owner': 'liwan_ai_notify', 'model': SETTINGS_MODEL, 'feature_key': 'ai.enabled'},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        domains = super()._liwan_notify_visible_domain()
        if self.env['liwan.access.service']._liwan_has_capability(self.env.user, AI_SETTINGS_MANAGE):
            domains.append([
                ('mail_message_id.liwan_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', SETTINGS_MODEL),
            ])
        return domains

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'title': html2plaintext(message.body).strip(),
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)


class LiwanAiLimitAudit(models.Model):
    _inherit = 'liwan.ai.audit'

    @api.model_create_multi
    def create(self, vals_list):
        rows = super().create(vals_list)
        if any(row.kind == 'message' for row in rows):
            self._liwan_warn_near_limits()
        return rows

    @api.model
    def _liwan_warn_near_limits(self):
        entitlement = self.env['liwan.entitlement.service']
        reached = []
        used = {'messages': self._liwan_ai_count_messages()}
        limits = {'messages': entitlement._liwan_limit_value('ai.messages.monthly')}
        if self.env[SETTINGS_MODEL]._liwan_current().provider_mode == 'platform':
            used['tokens'] = self.env['liwan.ai.usage']._liwan_platform_tokens_used()
            limits['tokens'] = entitlement._liwan_limit_value('ai.tokens.monthly')
        for name, limit in limits.items():
            if limit and used[name] >= WARNING_RATIO * limit:
                reached.append(name)
        if reached:
            self._liwan_deliver_warnings(reached)

    @api.model
    def _liwan_deliver_warnings(self, reached):
        access = self.env['liwan.access.service']
        managers = self.env.ref('liwan_ai.group_cap_ai_settings_manage').user_ids.filtered(
            lambda user: user.active and access._liwan_has_capability(user, AI_SETTINGS_MANAGE),
        )
        month = self._liwan_ai_month_start().strftime('%Y-%m')
        settings = self.env[SETTINGS_MODEL]._liwan_current()
        notify = self.env['liwan.notify.service']
        for name in reached:
            for user in managers:
                notify._liwan_deliver(
                    SETTINGS_MODEL, settings.id, KIND, user.partner_id, BODIES[name],
                    key=f'{KIND}:{name}:{month}:{user.id}',
                )
