# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

from .protected_write import is_marked_write

PARTNER_GRANT_MARKER = 'liwan_core.access_grant_partner_ids'
PARTNER_GRANT_FIELDS = {
    'active', 'company_id', 'email', 'image_1920', 'name', 'properties',
}
# liwan.access.service._liwan_create_invitee marks the caller's uid for the one contact it creates; the
# access-grant capability holds no general res.partner create right.
PARTNER_CREATE_MARKER = 'liwan_core.access_grant_partner_create'
PARTNER_BRANDING_MARKER = 'liwan_core.branding_partner_ids'
PARTNER_BRANDING_FIELDS = {'image_1920', 'name'}
PARTNER_COMPANY_MARKER = 'liwan_core.company_profile_partner_ids'
# The partner side of the generic company profile: identity, address and contact. Applications add their own
# fields through ``res.company._liwan_company_profile_extensions``.
PARTNER_COMPANY_FIELDS = {
    'image_1920', 'name', 'company_registry', 'vat', 'email', 'phone', 'website',
    'street', 'street2', 'city', 'zip', 'state_id',
}
# An application's marker never reaches these: the users of a partner are account identity, which only the protected
# account operations of liwan.access.service change.
EXTENSION_BLOCKED_FIELDS = frozenset({'user_ids'})


class LiwanResPartner(models.Model):
    _inherit = 'res.partner'

    def check_access(self, operation):
        if operation == 'create' and self.env.uid in self.env.cr.precommit.data.get(PARTNER_CREATE_MARKER, set()):
            return None
        return super().check_access(operation)

    @api.model
    def _liwan_marked_write_fields(self):
        """Extension point: ``{marker: fields}`` an addon's own guarded operation may write.

        Each owner extends it with its own marker and writes through ``marked``; the guard below lets a protected
        actor's marked write of exactly those fields through, never on a user's or a company's partner.
        """
        return {}

    @api.model
    def _liwan_application_write_fields(self):
        """The addons' marked fields, refused when one names a structural field."""
        declared = self._liwan_marked_write_fields()
        for marker, names in declared.items():
            if EXTENSION_BLOCKED_FIELDS.intersection(names):
                msg = 'partner write marker %s names a structural field' % marker
                raise ValueError(msg)
        return declared

    def _liwan_application_write_allowed(self, vals):
        """Whether one addon marker covers every partner and every field, none of them an account's or a company's."""
        if not any(
            is_marked_write(self, marker, fields, vals) for marker, fields in self._liwan_application_write_fields().items()
        ):
            return False
        return not (self._liwan_has_account() or self.env['res.company']._liwan_has_company_partner(self.ids))

    def _liwan_has_account(self):
        """Whether any of these partners is the partner of a user, active or archived, in any company (a boolean only).

        Elevated: rule_access_users_company hides the users homed in other companies from an access reader.
        """
        users = self.env['res.users'].sudo().with_context(active_test=False)
        return bool(users.search_count([('partner_id', 'in', self.ids)], limit=1))

    def write(self, vals):
        if self.env.is_superuser() or self.env.user.has_group('base.group_system'):
            return super().write(vals)
        company = self.env['res.company']
        company_profile_allowed = is_marked_write(
            self, PARTNER_COMPANY_MARKER,
            PARTNER_COMPANY_FIELDS | company._liwan_company_profile_extension_fields(), vals,
        )
        identity_fields = {'name', 'image_1920', 'image_1024', 'image_512', 'image_256', 'image_128'}
        if (
            not company_profile_allowed
            and identity_fields.intersection(vals)
            and company._liwan_has_company_partner(self.ids)
        ):
            raise AccessError(self.env._('Only Odoo system administrators can change institution name and logo.'))
        service = self.env['liwan.access.service']
        protected_actor = (
            self.env.user._liwan_is_customer_actor()
            or service._liwan_has_capability(self.env.user, 'settings.branding.manage')
            or service._liwan_has_capability(self.env.user, 'settings.company.manage')
        )
        if protected_actor:
            marker = self.env.cr.precommit.data
            grant_allowed = (
                bool(self.ids)
                and set(self.ids) <= marker.get(PARTNER_GRANT_MARKER, set())
                and set(vals) <= PARTNER_GRANT_FIELDS
            )
            branding_allowed = is_marked_write(self, PARTNER_BRANDING_MARKER, PARTNER_BRANDING_FIELDS, vals)
            if not (
                grant_allowed or branding_allowed or company_profile_allowed
                or self._liwan_application_write_allowed(vals)
            ):
                fields = ','.join(sorted(vals))
                msg = f'use_protected_liwan_access_operation:res_partner_write:{fields}'
                raise AccessError(msg)
        return super().write(vals)
