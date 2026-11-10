# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell rows a tenant's AI settings managers get: once a month per message limit when usage reaches 80% of it, and per
granted balance total when the prepaid balance falls below 20% of it and again when it reaches zero.

No sudo: the sender's message audit delivers it in the sender's environment, and a row shows only to a user
who still holds ``ai.settings.manage``.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_ai.models.tool_registry import ASSIST_KINDS
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'ai.limit_warning'
SETTINGS_MODEL = 'liwan.ai.settings'
WARNING_RATIO = 0.8
# The balance warns once below this share of the cumulative granted total, and once at zero; a new top-up changes the total.
BALANCE_LOW_RATIO = 0.2
BODIES = {
    'messages': 'وصل استخدام رسائل الذكاء الاصطناعي هذا الشهر إلى 80% من الحد.',
    'assist': 'وصل استخدام مساعدَي الإعداد والمساعدة هذا الشهر إلى 80% من الحد.',
    'balance_low': 'انخفض رصيد الذكاء الاصطناعي إلى أقل من 20% من إجمالي ما اشتُري منه.',
    'balance_empty': 'نفد رصيد الذكاء الاصطناعي. يتوقف المساعد عن بدء محادثات جديدة حتى يُشحن الرصيد.',
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
            self._liwan_warn_near_limits(('messages',))
        if any(row.kind in ASSIST_KINDS for row in rows):
            self._liwan_warn_near_limits(('assist',))
        return rows

    @api.model
    def _liwan_warn_near_limits(self, names):
        """Warn for each of ``names`` (``messages``, ``assist`` for the free agents' budget) whose monthly use reached 80% of its limit."""
        entitlement = self.env['liwan.entitlement.service']
        checks = {
            'messages': (self._liwan_ai_count_messages, 'ai.messages.monthly'),
            'assist': (lambda: self._liwan_ai_count_messages(kinds=ASSIST_KINDS), 'ai.assist.monthly'),
        }
        reached = []
        for name in names:
            count, key = checks[name]
            limit = entitlement._liwan_limit_value(key)
            if limit and count() >= WARNING_RATIO * limit:
                reached.append(name)
        if reached:
            self._liwan_deliver_warnings(reached)

    @api.model
    def _liwan_deliver_warnings(self, reached, period=None):
        """One bell row per manager for each of ``reached``, once per ``period`` (default: this month) and manager."""
        access = self.env['liwan.access.service']
        managers = self.env.ref('liwan_ai.group_cap_ai_settings_manage').user_ids.filtered(
            lambda user: user.active and access._liwan_has_capability(user, AI_SETTINGS_MANAGE),
        )
        period = period or self._liwan_ai_month_label()
        settings = self.env[SETTINGS_MODEL]._liwan_current()
        notify = self.env['liwan.notify.service']
        for name in reached:
            for user in managers:
                notify._liwan_deliver(
                    SETTINGS_MODEL, settings.id, KIND, user.partner_id, BODIES[name],
                    key=f'{KIND}:{name}:{period}:{user.id}',
                )


class LiwanAiLimitUsage(models.Model):
    _inherit = 'liwan.ai.usage'

    @api.model
    def _liwan_cron_warn_balance(self):
        """Warn once when the balance falls below 20% of the granted total, and once when it reaches zero.

        A cron runs it, because the usage recorder that deducts the charges cannot read the managers it would tell (it holds one
        capability and nothing else) and nothing here may be elevated. Each warning is keyed by the granted total it was judged
        against, so a top-up (a larger total) arms both again; running it again changes nothing until the balance crosses a
        threshold. A tenant without a balance never warns.
        """
        state = self.env['liwan.ai.balance']._liwan_ai_balance_state()
        granted, left = state['balance_granted'], state['balance_left']
        if not granted:
            return
        if left <= 0:
            self.env['liwan.ai.audit']._liwan_deliver_warnings(['balance_empty'], period=granted)
        elif left < BALANCE_LOW_RATIO * granted:
            self.env['liwan.ai.audit']._liwan_deliver_warnings(['balance_low'], period=granted)
