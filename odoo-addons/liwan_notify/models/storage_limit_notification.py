# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell row and email the tenant's administrators get when attachment storage reaches 80% and then 95% of its limit.

The platform's own kind: it belongs to no application, so it has no feature key. Storage is tenant-wide, so the
recipients are the holders of the settings-administration capabilities in the tenant's root company (the people who
open ``/subscription``), whichever company the uploading user works in. A notice goes out only when a claim crosses a
threshold upward, and only in SaaS: the upgrade page it links to is commercial and does not exist otherwise. Nothing is
elevated here: the delivery runs in the uploader's environment, like the AI limit warning, and an upload by a portal
or public user warns nobody (the next internal upload does). Upgrading storage stays manual and the hard refusal at
100% is the platform's.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.serializers.common import iso

KIND = 'storage.limit_warning'
PROFILE_MODEL = 'liwan.tenant.profile'
# Highest first: a claim that crosses both thresholds sends only the higher notice.
WARNING_PERCENTS = (95, 80)
ADMIN_CAPABILITIES = frozenset({'settings.branding.manage', 'access.roles.manage'})
UPGRADE_PATH = '/subscription/change'
BODIES = {
    80: 'وصل استخدام مساحة التخزين إلى 80% من الحد. يمكنك زيادة المساحة من صفحة الاشتراك.',
    95: 'مساحة التخزين على وشك الامتلاء: وصل الاستخدام إلى 95% من الحد. زد المساحة من صفحة الاشتراك قبل أن يتوقف رفع الملفات.',
}
SUBJECT = 'مساحة التخزين تقترب من الحد | Storage is nearing its limit'
ENGLISH = {
    80: 'Your storage usage reached 80% of the limit. You can add more space from the subscription page.',
    95: 'Your storage is almost full: usage reached 95% of the limit. Add more space from the subscription page before file uploads stop.',
}


class LiwanNotifyStorageMessage(models.Model):
    _inherit = 'mail.message'

    liwan_notification_kind = fields.Selection(
        selection_add=[(KIND, 'Storage limit warning')], ondelete={KIND: 'cascade'},
    )


class LiwanNotifyStorageTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            {'kind': KIND, 'owner': 'liwan_notify', 'model': PROFILE_MODEL},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        domains = super()._liwan_notify_visible_domain()
        if self.env['liwan.notify.storage.limit']._liwan_is_administrator(self.env.user):
            domains.append([
                ('mail_message_id.liwan_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', PROFILE_MODEL),
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


class LiwanNotifyStorageEntitlement(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_storage_claimed(self, used_before, used_after, limit_bytes):
        super()._liwan_storage_claimed(used_before, used_after, limit_bytes)
        if self._liwan_profile().commercial_mode != 'saas' or (self.env.user.share and not self.env.su):
            return
        # The highest threshold this claim crosses upward; a claim that starts at or above a threshold crosses nothing.
        percent = next(
            (step for step in WARNING_PERCENTS if used_before * 100 < step * limit_bytes <= used_after * 100), None,
        )
        if percent is not None:
            self.env['liwan.notify.storage.limit']._liwan_warn(percent, limit_bytes // 1048576)


class LiwanNotifyStorageLimit(models.AbstractModel):
    _name = 'liwan.notify.storage.limit'
    _description = 'LiwanOS storage limit warning'
    _liwan_scope = 'global'

    @api.model
    def _liwan_is_administrator(self, user):
        """True for a user who holds a settings-administration capability in the tenant's root company."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        keys = self.env['liwan.access.service']._liwan_capability_keys(user, company=root)
        return bool(ADMIN_CAPABILITIES & keys)

    @api.model
    def _liwan_administrators(self):
        """The active internal users to warn: administrators of the tenant, never the vendor's own support accounts."""
        excluded = self.env['liwan.entitlement.service']._liwan_excluded_user_ids()
        candidates = self.env.ref('liwan_core.group_cap_settings_branding_manage').all_user_ids | self.env.ref(
            'liwan_core.group_cap_access_roles_manage',
        ).all_user_ids
        return candidates.filtered(
            lambda user: user.active and not user.share and user.id not in excluded and self._liwan_is_administrator(user),
        )

    @api.model
    def _liwan_warn(self, percent, limit_mb):
        """Tell each administrator once per threshold and limit: a new limit after an upgrade warns again.

        The caller sends only for an upward crossing, so no earlier-notice lookup is needed; the delivery key makes a
        repeated crossing of the same threshold under the same limit a no-op.
        """
        profile = self.env['liwan.entitlement.service']._liwan_profile()
        notify = self.env['liwan.notify.service']
        mail = self.env['liwan.notify.mail']
        for user in self._liwan_administrators():
            delivered = notify._liwan_deliver(
                PROFILE_MODEL, profile.id, KIND, user.partner_id, BODIES[percent],
                key=self._liwan_key(percent, limit_mb, user),
            )
            if delivered:
                mail._liwan_send(user, SUBJECT, (BODIES[percent], ENGLISH[percent]), UPGRADE_PATH)

    @api.model
    def _liwan_key(self, percent, limit_mb, user):
        return f'{KIND}:{percent}:{limit_mb}:{user.id}'
