# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import reset_cached_properties

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

    webvue_branch_access_mode = fields.Selection(
        [('isolated', 'Isolated'), ('delegated', 'Delegated'), ('inherited', 'Inherited')],
        default='delegated', required=True, readonly=True,
    )

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )

    @api.model
    def _webvue_marked_write_fields(self):
        """Extension point: ``{marker: fields}`` an application's own guarded operation may write.

        Each application owns its marker and writes through ``marked``; the core guard below lets
        a marked write of exactly those fields through for a caller holding a settings capability.
        """
        return {}

    @api.model
    def _webvue_application_write_fields(self):
        """The applications' marked fields, refused when one names a structural field."""
        declared = self._webvue_marked_write_fields()
        for marker, names in declared.items():
            if EXTENSION_BLOCKED_FIELDS.intersection(names):
                msg = 'company write marker %s names a structural field' % marker
                raise ValueError(msg)
        return declared

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_system():
            raise AccessError(self.env._('Only Odoo system administrators can create institutions.'))
        return super().create(vals_list)

    def write(self, vals):
        if ('webvue_branch_access_mode' in vals and not self.env.is_superuser()
                and self.env.company.id not in self.env.cr.precommit.data.get('webvue_core.branch_policy', set())):
            msg = 'use_protected_webvue_access_operation'
            raise AccessError(msg)
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
        # Default deny: whichever group an addon grants the company write ACL to, a caller who is not
        # an Odoo administrator writes only through one of the marked operations below.
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            branding_allowed = is_marked_write(self, BRANDING_COMPANY_MARKER, BRANDING_COMPANY_FIELDS, vals)
            application_allowed = any(
                is_marked_write(self, marker, fields, vals)
                for marker, fields in self._webvue_application_write_fields().items()
            )
            if not (branding_allowed or profile_allowed or application_allowed or (
                set(vals) == {'webvue_branch_access_mode'}
                and self.id in self.env.cr.precommit.data.get('webvue_core.branch_policy', set())
            )):
                msg = 'use_protected_webvue_access_operation'
                raise AccessError(msg)
        result = super().write(vals)
        if 'user_ids' in vals:
            # Inverse of res.users.company_ids: invalidate the same native company cache.
            self.env.registry.clear_cache()
            # Match native res.users.write(company_ids): cached env.companies must
            # refresh too when the inverse adds or removes a membership.
            for environment in list(self.env.transaction.envs):
                reset_cached_properties(environment)
        if {'parent_id', 'active', 'webvue_branch_access_mode', 'user_ids'}.intersection(vals):
            service._webvue_clear_branch_cache()
        return result

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
    def _webvue_check_company_field_extensions(self, purpose, specs, reserved_fields, kinds, sections=None):
        """Check extension ``specs`` that name ``res.company`` fields; a bad declaration is a programming error.

        The one validator behind every extension point of this shape. ``purpose`` names the extension point in
        error messages, ``reserved_fields`` are the fields its owner already handles, ``kinds`` maps a field
        type to the spec ``kind`` it allows and ``sections`` (when given) are the allowed ``section`` values.
        Fields in ``EXTENSION_BLOCKED_FIELDS`` are refused for every extension point.
        """
        for spec in specs:
            name = spec.get('name')
            field = self._fields.get(name)
            if field is None:
                msg = f'{purpose} extension {name!r} is not a res.company field'
                raise ValueError(msg)
            if name in reserved_fields or name in EXTENSION_BLOCKED_FIELDS:
                msg = f'{purpose} extension {name!r} is a generic or protected field'
                raise ValueError(msg)
            if sections is not None and spec.get('section') not in sections:
                msg = f'{purpose} extension {name!r} has an unknown section {spec.get("section")!r}'
                raise ValueError(msg)
            if kinds.get(field.type) != spec.get('kind'):
                msg = f'{purpose} extension {name!r}: kind {spec.get("kind")!r} does not fit a {field.type} field'
                raise ValueError(msg)
        return specs

    @api.model
    def _webvue_company_profile_extension_specs(self):
        """The declared extensions, each checked: a bad declaration is a programming error and raises."""
        return self._webvue_check_company_field_extensions(
            'company profile', self._webvue_company_profile_extensions(),
            COMPANY_PROFILE_FIELDS, EXTENSION_KINDS, EXTENSION_SECTIONS,
        )

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
