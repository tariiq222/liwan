# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell row the requester gets when the tenant data export is ready to download, or has failed.

The platform's own kind (no application feature). It is addressed to the one account that asked, and it stays listed only
while that account still holds the export capability.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.models.tenant_export_access import TENANT_EXPORT
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'tenant.export_result'
EXPORT_MODEL = 'liwan.tenant.export'
READY_BODY = 'ملف بيانات منشأتك جاهز للتنزيل. يبقى متاحًا سبعة أيام ثم يُحذف.'
FAILED_BODY = 'تعذّر تجهيز ملف بيانات منشأتك. أعد الطلب لاحقًا، وإن تكرر الأمر فتواصل مع الدعم.'
DISK_BODY = 'لم يُجهَّز ملف بيانات منشأتك لأن مساحة التخزين الحرة غير كافية الآن. أعد الطلب لاحقًا.'


class LiwanNotifyExportMessage(models.Model):
    _inherit = 'mail.message'

    liwan_notification_kind = fields.Selection(
        selection_add=[(KIND, 'Tenant export result')], ondelete={KIND: 'cascade'},
    )


class LiwanNotifyExportTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (*super()._liwan_notification_types(), {'kind': KIND, 'owner': 'liwan_notify', 'model': EXPORT_MODEL})

    @api.model
    def _liwan_notify_visible_domain(self):
        domains = super()._liwan_notify_visible_domain()
        if self.env['liwan.access.service']._liwan_has_capability(self.env.user, TENANT_EXPORT):
            domains.append([
                ('mail_message_id.liwan_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', EXPORT_MODEL),
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


class LiwanNotifyTenantExport(models.Model):
    _inherit = 'liwan.tenant.export'

    def _liwan_notify_outcome(self):
        super()._liwan_notify_outcome()
        requester = self._liwan_requester()
        if not requester:
            return
        body = {'done': READY_BODY, 'failed': DISK_BODY if self.failure == 'insufficient_disk' else FAILED_BODY}.get(self.state)
        if body:
            self.env['liwan.notify.service']._liwan_deliver(
                EXPORT_MODEL, self.id, KIND, requester.partner_id, body, key=f'{KIND}:{self.id}:{self.state}',
            )
