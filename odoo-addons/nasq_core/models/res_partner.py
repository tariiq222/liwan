# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

PARTNER_GRANT_MARKER = 'nasq_core.access_grant_partner_ids'
PARTNER_GRANT_FIELDS = {
    'active', 'company_id', 'email', 'image_1920', 'name', 'properties',
}
PARTNER_BRANDING_MARKER = 'nasq_core.branding_partner_ids'
PARTNER_BRANDING_FIELDS = {'image_1920', 'name'}


class NasqResPartner(models.Model):
    _inherit = 'res.partner'

    def write(self, vals):
        if self.env.is_superuser() or self.env.user.has_group('base.group_system'):
            return super().write(vals)
        service = self.env['nasq.access.service']
        protected_actor = (
            self.env.user._nasq_is_customer_actor()
            or service._nasq_has_capability(
                self.env.user, 'settings.branding.manage',
            )
        )
        if protected_actor:
            marker = self.env.cr.precommit.data
            grant_allowed = (
                bool(self.ids)
                and set(self.ids) <= marker.get(PARTNER_GRANT_MARKER, set())
                and set(vals) <= PARTNER_GRANT_FIELDS
            )
            branding_allowed = (
                bool(self.ids)
                and set(self.ids) <= marker.get(PARTNER_BRANDING_MARKER, set())
                and set(vals) <= PARTNER_BRANDING_FIELDS
            )
            if not grant_allowed and not branding_allowed:
                fields = ','.join(sorted(vals))
                msg = f'use_protected_nasq_access_operation:res_partner_write:{fields}'
                raise AccessError(msg)
        return super().write(vals)
