# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

from .protected_write import is_marked_write

PARTNER_GRANT_MARKER = 'webvue_core.access_grant_partner_ids'
PARTNER_GRANT_FIELDS = {
    'active', 'company_id', 'email', 'image_1920', 'name', 'properties',
}
PARTNER_BRANDING_MARKER = 'webvue_core.branding_partner_ids'
PARTNER_BRANDING_FIELDS = {'image_1920', 'name'}
PARTNER_COMPANY_MARKER = 'webvue_core.company_profile_partner_ids'
# The partner side of the generic company profile: identity, address and contact. Applications add their own
# fields through ``res.company._webvue_company_profile_extensions``.
PARTNER_COMPANY_FIELDS = {
    'image_1920', 'name', 'company_registry', 'vat', 'email', 'phone', 'website',
    'street', 'street2', 'city', 'zip', 'state_id',
}


class WebVueResPartner(models.Model):
    _inherit = 'res.partner'

    def write(self, vals):
        if self.env.is_superuser() or self.env.user.has_group('base.group_system'):
            return super().write(vals)
        company = self.env['res.company']
        company_profile_allowed = is_marked_write(
            self, PARTNER_COMPANY_MARKER,
            PARTNER_COMPANY_FIELDS | company._webvue_company_profile_extension_fields(), vals,
        )
        identity_fields = {'name', 'image_1920', 'image_1024', 'image_512', 'image_256', 'image_128'}
        if (
            not company_profile_allowed
            and identity_fields.intersection(vals)
            and company._webvue_has_company_partner(self.ids)
        ):
            raise AccessError(self.env._('Only Odoo system administrators can change institution name and logo.'))
        service = self.env['webvue.access.service']
        protected_actor = (
            self.env.user._webvue_is_customer_actor()
            or service._webvue_has_capability(self.env.user, 'settings.branding.manage')
            or service._webvue_has_capability(self.env.user, 'settings.company.manage')
        )
        if protected_actor:
            marker = self.env.cr.precommit.data
            grant_allowed = (
                bool(self.ids)
                and set(self.ids) <= marker.get(PARTNER_GRANT_MARKER, set())
                and set(vals) <= PARTNER_GRANT_FIELDS
            )
            branding_allowed = is_marked_write(self, PARTNER_BRANDING_MARKER, PARTNER_BRANDING_FIELDS, vals)
            if not (grant_allowed or branding_allowed or company_profile_allowed):
                fields = ','.join(sorted(vals))
                msg = f'use_protected_webvue_access_operation:res_partner_write:{fields}'
                raise AccessError(msg)
        return super().write(vals)
