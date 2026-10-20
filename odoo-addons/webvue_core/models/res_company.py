# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .protected_write import is_marked_write, marked
from .res_partner import (
    PARTNER_BRANDING_MARKER,
    PARTNER_COMPANY_FIELDS,
    PARTNER_COMPANY_MARKER,
)

BRANDING_COMPANY_MARKER = 'webvue_core.branding_company_ids'
BRANDING_COMPANY_FIELDS = {'primary_color', 'secondary_color'}
COMPANY_PROFILE_MARKER = 'webvue_core.company_profile_company_ids'
# Company-side names of the partner fields above: the logo is the partner image, the tagline is the company's.
COMPANY_PROFILE_FIELDS = (PARTNER_COMPANY_FIELDS - {'image_1920'}) | {'logo', 'report_header'}
# An extension never reaches these: the country is set at provisioning, the others are structural.
EXTENSION_BLOCKED_FIELDS = frozenset({'country_id', 'partner_id', 'currency_id'})
EXTENSION_SECTIONS = frozenset({'identity', 'address'})
EXTENSION_KINDS = {'char': 'text', 'selection': 'selection'}


class ResCompany(models.Model):
    _inherit = 'res.company'

    secondary_color = fields.Char()

    webvue_access_policy_version = fields.Integer(default=1, required=True)

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_system():
            raise AccessError(self.env._('Only Odoo system administrators can create institutions.'))
        return super().create(vals_list)

    def write(self, vals):
        profile_allowed = is_marked_write(
            self, COMPANY_PROFILE_MARKER, COMPANY_PROFILE_FIELDS | self._webvue_company_profile_extension_fields(), vals,
        )
        if (
            not profile_allowed
            and {'name', 'logo', 'logo_web', 'partner_id'}.intersection(vals)
            and not self.env.is_system()
        ):
            raise AccessError(self.env._('Only Odoo system administrators can change institution name and logo.'))
        service = self.env['webvue.access.service']
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and (
                service._webvue_has_capability(self.env.user, 'settings.branding.manage')
                or service._webvue_has_capability(self.env.user, 'settings.company.manage')
            )
        ):
            branding_allowed = is_marked_write(self, BRANDING_COMPANY_MARKER, BRANDING_COMPANY_FIELDS, vals)
            if not (branding_allowed or profile_allowed):
                msg = 'use_protected_webvue_access_operation'
                raise AccessError(msg)
        return super().write(vals)

    def _webvue_write_branding(self, vals):
        self.ensure_one()
        service = self.env['webvue.access.service']
        service._webvue_require_capability('settings.branding.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        if not vals or set(vals) - BRANDING_COMPANY_FIELDS:
            msg = 'invalid_branding_fields'
            raise AccessError(msg)
        with marked(self.env, {BRANDING_COMPANY_MARKER: {self.id}, PARTNER_BRANDING_MARKER: {self.partner_id.id}}):
            return super().write(vals)

    def _webvue_write_company_profile(self, vals):
        """Write whitelisted identity, address and contact fields of the current company.

        Not elevated: the caller's own ACL and record rule (``settings.company.manage`` group, current
        company) decide, and the markers only let this field set through the res.company / res.partner guards.
        Fields declared by ``_webvue_company_profile_extensions`` are accepted as well.
        """
        self.ensure_one()
        self.env['webvue.access.service']._webvue_require_capability('settings.company.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        allowed = COMPANY_PROFILE_FIELDS | self._webvue_company_profile_extension_fields()
        if not vals or set(vals) - allowed:
            msg = 'invalid_company_profile_fields'
            raise AccessError(msg)
        with marked(self.env, {COMPANY_PROFILE_MARKER: {self.id}, PARTNER_COMPANY_MARKER: {self.partner_id.id}}):
            return self.write(vals)

    @api.model
    def _webvue_company_profile_extensions(self):
        """Profile fields an installed application adds to the generic company profile.

        Extension point: override with ``super()`` and append specs ``{'name': <res.company field>,
        'section': 'identity' | 'address', 'kind': 'text' | 'selection'}``, optionally with ``label``
        (translated; defaults to the field description) and ``inputmode`` (a UI hint for text). The field must
        exist on ``res.company`` and ``res.partner``, with a matching type. The profile API returns and accepts
        these fields generically. Read the specs through ``_webvue_company_profile_extension_specs``.
        """
        return []

    @api.model
    def _webvue_company_profile_extension_specs(self):
        """The declared extensions, each checked: a bad declaration is a programming error and raises."""
        specs = self._webvue_company_profile_extensions()
        for spec in specs:
            name = spec.get('name')
            field = self._fields.get(name)
            if field is None:
                msg = f'company profile extension {name!r} is not a res.company field'
                raise ValueError(msg)
            if name in COMPANY_PROFILE_FIELDS or name in EXTENSION_BLOCKED_FIELDS:
                msg = f'company profile extension {name!r} is a generic or protected field'
                raise ValueError(msg)
            if spec.get('section') not in EXTENSION_SECTIONS:
                msg = f'company profile extension {name!r} has an unknown section {spec.get("section")!r}'
                raise ValueError(msg)
            if EXTENSION_KINDS.get(field.type) != spec.get('kind'):
                msg = f'company profile extension {name!r}: kind {spec.get("kind")!r} does not fit a {field.type} field'
                raise ValueError(msg)
        return specs

    @api.model
    def _webvue_company_profile_extension_fields(self):
        return {spec['name'] for spec in self._webvue_company_profile_extension_specs()}

    @api.model
    def _webvue_has_company_partner(self, partner_ids):
        # Read-only security classification across record rules, never a write or data response.
        # A hidden or archived company must not turn its partner into an editable contact.
        return bool(self.sudo().with_context(active_test=False).search_count([
            ('partner_id', 'in', partner_ids),
        ], limit=1))
