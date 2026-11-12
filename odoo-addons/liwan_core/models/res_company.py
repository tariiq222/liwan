# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.tools import reset_cached_properties

from .access_service import SELF_GRANT_POLICY_MARKER, VAT_PERMISSION
from .protected_write import is_marked_write, marked
from .res_partner import (
    PARTNER_BRANDING_MARKER,
    PARTNER_COMPANY_FIELDS,
    PARTNER_COMPANY_MARKER,
)

BRANDING_COMPANY_MARKER = 'liwan_core.branding_company_ids'
BRANDING_COMPANY_FIELDS = {'primary_color', 'secondary_color'}
COMPANY_PROFILE_MARKER = 'liwan_core.company_profile_company_ids'
# Company-side names of the partner fields above: the logo is the partner image, the tagline is the company's.
COMPANY_PROFILE_FIELDS = (PARTNER_COMPANY_FIELDS - {'image_1920'}) | {'logo', 'report_header', 'liwan_vat_registered'}
# An extension never reaches these: the country is set at provisioning, the others are structural.
EXTENSION_BLOCKED_FIELDS = frozenset({'country_id', 'partner_id', 'currency_id'})
EXTENSION_SECTIONS = frozenset({'identity', 'address'})
EXTENSION_KINDS = {'char': 'text', 'selection': 'selection'}


class ResCompany(models.Model):
    _inherit = 'res.company'

    secondary_color = fields.Char()

    liwan_access_policy_version = fields.Integer(default=1, required=True)

    # Whether the company is registered for VAT: only then is a tax computed, shown or invoiced anywhere its
    # customers or its end customers look, and only then is the VAT number required. Off by default.
    liwan_vat_registered = fields.Boolean(default=False, copy=False)

    liwan_branch_access_mode = fields.Selection(
        [('isolated', 'Isolated'), ('delegated', 'Delegated'), ('inherited', 'Inherited')],
        default='delegated', required=True, readonly=True,
    )

    # Whether an administrator may grant themselves access beyond system administration (read-only: written
    # only by the marker-guarded liwan.access.service._liwan_set_self_grant_policy).
    liwan_self_grant_policy = fields.Selection(
        [('restricted', 'Restricted'), ('allowed', 'Allowed')],
        default='restricted', required=True, readonly=True,
    )

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )

    @api.model
    def _liwan_marked_write_fields(self):
        """Extension point: ``{marker: fields}`` an application's own guarded operation may write.

        Each application owns its marker and writes through ``marked``; the core guard below lets
        a marked write of exactly those fields through for a caller holding a settings capability.
        """
        return {}

    @api.model
    def _liwan_application_write_fields(self):
        """The applications' marked fields, refused when one names a structural field."""
        declared = self._liwan_marked_write_fields()
        for marker, names in declared.items():
            if EXTENSION_BLOCKED_FIELDS.intersection(names):
                msg = 'company write marker %s names a structural field' % marker
                raise ValueError(msg)
        return declared

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_system():
            raise AccessError(self.env._('Only Odoo system administrators can create institutions.'))
        companies = super().create(vals_list)
        # A company created already registered is a registration change too: from the default, not registered.
        companies.filtered('liwan_vat_registered')._liwan_log_vat_registration(dict.fromkeys(companies.ids, False))
        return companies

    def write(self, vals):
        if ('liwan_branch_access_mode' in vals and not self.env.is_superuser()
                and self.env.company.id not in self.env.cr.precommit.data.get('liwan_core.branch_policy', set())):
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        policy_allowed = is_marked_write(self, SELF_GRANT_POLICY_MARKER, {'liwan_self_grant_policy'}, vals)
        if 'liwan_self_grant_policy' in vals and not self.env.is_superuser() and not policy_allowed:
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        profile_allowed = is_marked_write(
            self, COMPANY_PROFILE_MARKER, COMPANY_PROFILE_FIELDS | self._liwan_company_profile_extension_fields(), vals,
        )
        if (
            not profile_allowed
            and {'name', 'logo', 'logo_web', 'partner_id'}.intersection(vals)
            and not self.env.is_system()
        ):
            raise AccessError(self.env._('Only Odoo system administrators can change institution name and logo.'))
        service = self.env['liwan.access.service']
        # Default deny: whichever group an addon grants the company write ACL to, a caller who is not
        # an Odoo administrator writes only through one of the marked operations below.
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            branding_allowed = is_marked_write(self, BRANDING_COMPANY_MARKER, BRANDING_COMPANY_FIELDS, vals)
            application_allowed = any(
                is_marked_write(self, marker, fields, vals)
                for marker, fields in self._liwan_application_write_fields().items()
            )
            if not (branding_allowed or profile_allowed or application_allowed or policy_allowed or (
                set(vals) == {'liwan_branch_access_mode'}
                and self.id in self.env.cr.precommit.data.get('liwan_core.branch_policy', set())
            )):
                msg = 'use_protected_liwan_access_operation'
                raise AccessError(msg)
        previous = {company.id: company.liwan_vat_registered for company in self}
        result = super().write(vals)
        if 'liwan_vat_registered' in vals:
            self._liwan_log_vat_registration(previous)
        if 'user_ids' in vals:
            # Inverse of res.users.company_ids: invalidate the same native company cache.
            self.env.registry.clear_cache()
            # Match native res.users.write(company_ids): cached env.companies must
            # refresh too when the inverse adds or removes a membership.
            for environment in list(self.env.transaction.envs):
                reset_cached_properties(environment)
        if {'parent_id', 'active', 'liwan_branch_access_mode', 'user_ids'}.intersection(vals):
            service._liwan_clear_branch_cache()
        return result

    def _liwan_write_branding(self, vals):
        self.ensure_one()
        service = self.env['liwan.access.service']
        service._liwan_require_capability('settings.branding.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        if not vals or set(vals) - BRANDING_COMPANY_FIELDS:
            msg = 'invalid_branding_fields'
            raise AccessError(msg)
        with marked(self.env, {BRANDING_COMPANY_MARKER: {self.id}, PARTNER_BRANDING_MARKER: {self.partner_id.id}}):
            result = super().write(vals)
        self._liwan_log_company_change('company.branding_changed', vals)
        return result

    def _liwan_vat_registered(self):
        """Whether this company is registered for VAT; the one helper every other layer calls (R4: down only).

        Off by default: then no tax is computed, shown or invoiced anywhere the company's customers or
        their end customers look. Existing documents keep what they were issued with.
        """
        self.ensure_one()
        return bool(self.liwan_vat_registered)

    @api.model
    def _liwan_vat_number_is_checked(self):
        """Whether this database checks a VAT number against its country's format: only ``base_vat`` does.

        The module is the test, not the method: ``account`` also defines ``_run_vat_checks``, and its version
        returns the number it is given, so its existence says nothing.
        """
        return 'base_vat' in self.env['ir.module.module']._installed()

    def _liwan_require_vat_registration_right(self, registered):
        """Changing whether the company is registered for VAT needs ``settings.company.vat.manage``.

        The company profile's own capability (``settings.company.manage``, which custom roles may hold) is not
        enough: this decides whether any tax shows, so only the system administrator role holds it. Sending the
        value the company already has changes nothing and needs nothing.
        """
        self.ensure_one()
        if bool(registered) != self.liwan_vat_registered:
            self.env['liwan.access.service']._liwan_require_capability(VAT_PERMISSION)

    def _liwan_check_vat_registration(self):
        """Refuse a VAT-registered company without a valid VAT number: registering needs one, and so does keeping it.

        Odoo's own number check for the company's country (``base_vat``, the Saudi 15-digit TIN rule under
        ``l10n_sa``) decides, never a hand-written pattern. ``liwan_core`` depends on ``base`` only, so the
        check runs where ``base_vat`` is installed; the company profile route refuses to register a company
        where it is not (``vat_check_unavailable``), so no customer request registers an unchecked number.
        """
        for company in self:
            if not company.liwan_vat_registered:
                continue
            if not company.vat:
                raise ValidationError(self.env._('Enter the VAT number before registering the company for VAT.'))
            if company.country_id and self._liwan_vat_number_is_checked():
                self.env['res.partner']._run_vat_checks(company.country_id, company.vat, company.name)

    @api.constrains('liwan_vat_registered', 'vat')
    def _check_vat_registration(self):
        self._liwan_check_vat_registration()

    def _liwan_log_vat_registration(self, previous):
        """Record the VAT-registration change: who changed it and from what to what, never the VAT number itself.

        A write that leaves the value as it was records nothing.
        """
        for company in self:
            before = previous.get(company.id)
            if before == company.liwan_vat_registered:
                continue
            self.env['liwan.access.audit']._liwan_log(
                'company.vat_registration_changed', company,
                before={'vat_registered': before}, after={'vat_registered': company.liwan_vat_registered},
            )

    def _liwan_write_company_profile(self, vals):
        """Write whitelisted identity, address and contact fields of the current company.

        Not elevated: the caller's own ACL and record rule (``settings.company.manage`` group, current
        company) decide, and the markers only let this field set through the res.company / res.partner guards.
        Fields declared by ``_liwan_company_profile_extensions`` are accepted as well.
        """
        self.ensure_one()
        self.env['liwan.access.service']._liwan_require_capability('settings.company.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        allowed = COMPANY_PROFILE_FIELDS | self._liwan_company_profile_extension_fields()
        if not vals or set(vals) - allowed:
            msg = 'invalid_company_profile_fields'
            raise AccessError(msg)
        if 'liwan_vat_registered' in vals:
            self._liwan_require_vat_registration_right(vals['liwan_vat_registered'])
        with marked(self.env, {COMPANY_PROFILE_MARKER: {self.id}, PARTNER_COMPANY_MARKER: {self.partner_id.id}}):
            result = self.write(vals)
        self._liwan_log_company_change('company.profile_changed', vals)
        return result

    def _liwan_log_company_change(self, action, vals):
        """Record a profile or branding change in the access log: the names of the written fields, never their values.

        A binary field (the logo) or a long text would bloat the log, and the values are readable on the company.
        """
        self.env['liwan.access.audit']._liwan_log(action, self, after={'fields': sorted(vals)})

    @api.model
    def _liwan_company_profile_extensions(self):
        """Profile fields an installed application adds to the generic company profile.

        Extension point: override with ``super()`` and append specs ``{'name': <res.company field>,
        'section': 'identity' | 'address', 'kind': 'text' | 'selection'}``, optionally with ``label``
        (translated; defaults to the field description) and ``inputmode`` (a UI hint for text). The field must
        exist on ``res.company`` and ``res.partner``, with a matching type. The profile API returns and accepts
        these fields generically. Read the specs through ``_liwan_company_profile_extension_specs``.
        """
        return []

    @api.model
    def _liwan_check_company_field_extensions(self, purpose, specs, reserved_fields, kinds, sections=None):
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
    def _liwan_company_profile_extension_specs(self):
        """The declared extensions, each checked: a bad declaration is a programming error and raises."""
        return self._liwan_check_company_field_extensions(
            'company profile', self._liwan_company_profile_extensions(),
            COMPANY_PROFILE_FIELDS, EXTENSION_KINDS, EXTENSION_SECTIONS,
        )

    @api.model
    def _liwan_company_profile_extension_fields(self):
        return {spec['name'] for spec in self._liwan_company_profile_extension_specs()}

    @api.model
    def _liwan_company_partner_ids(self, partner_ids=None):
        # Storage classification must include archived and other companies. Only partner ids are returned.
        companies_sudo = self.sudo().with_context(active_test=False)
        domain = [] if partner_ids is None else [('partner_id', 'in', partner_ids)]
        return set(companies_sudo.search_fetch(domain, ['partner_id']).partner_id.ids)

    @api.model
    def _liwan_has_company_partner(self, partner_ids):
        return bool(self._liwan_company_partner_ids(partner_ids))
