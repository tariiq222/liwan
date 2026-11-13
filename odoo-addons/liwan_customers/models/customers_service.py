# Part of Odoo. See LICENSE file for full copyright and licensing details.
from markupsafe import Markup

from odoo import api, models
from odoo.exceptions import AccessError, UserError
from odoo.tools import email_normalize

from .access_service import CUSTOMERS_READ
from .customers_settings import PROPERTIES_FIELD
from .res_partner import PARTY_CREATE_MARKER, PARTY_MARKER
from odoo.addons.liwan_api.serializers.properties import parse_values, read_items
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.phone_validation.tools.phone_validation import phone_format

# Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits read as ASCII digits.
ARABIC_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
DEFAULT_PHONE_COUNTRY = 'base.sa'
NAME_MAX = 200
EMAIL_MAX = 254
# The identity values a caller gives for a new or an edited customer.
IDENTITY_KEYS = frozenset({'name', 'phone', 'email', 'is_company', 'parent_id'})
# What a caller may give a customer: the identity and the values of the tenant's customer fields, as ``{key: value}``.
CUSTOMER_KEYS = IDENTITY_KEYS | {'properties'}
ORDER = 'name, id'
# Adoption moves a legacy phone that does not validate into the partner's internal note, where staff still read it.
LEGACY_PHONE_NOTE = Markup('<p>Legacy phone, not a valid number: %s</p>')


def _refuse_invalid(field, message):
    """422 ``invalid`` on ``field``."""
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=field, status=422)


def _refuse_phone():
    """422 ``invalid_phone`` on ``phone``."""
    code = 'invalid_phone'
    raise LiwanAccessRule(code, 'the phone number is not valid', field='phone', status=422)


class LiwanCustomersService(models.AbstractModel):
    """The only writer of a commercial party's identity on ``res.partner``.

    Every method runs as the caller: the technical group ``group_customers_party_writer`` gives the right to write a
    party, the record rules and the company fence decide which parties the caller sees, and the sharing setting
    decides the company of a new one. Errors are ``LiwanAccessRule`` with the status ``api_handler`` answers.
    """
    _name = 'liwan.customers.service'
    _description = 'LiwanOS customers service'
    _liwan_scope = 'global'

    # ---- registry hooks: consuming applications extend them through super() ----

    @api.model
    def _liwan_customers_feature_keys(self):
        """Feature keys that open /api/v1/customers; the routes are open while any of them is readable."""
        return ()

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """Capability keys that may pick a customer inside the application's own action."""
        return ()

    @api.model
    def _liwan_can_pick(self):
        """Whether the caller holds ``customers.read`` or a registered pick capability in the current company."""
        service = self.env['liwan.access.service']
        return any(
            service._liwan_has_capability(self.env.user, key)
            for key in (CUSTOMERS_READ, *self._liwan_customers_pick_capabilities())
        )

    @api.model
    def _liwan_require_pick(self):
        """403 ``forbidden`` unless the caller may pick a customer (``_liwan_can_pick``)."""
        if not self._liwan_can_pick():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'picking a customer is not allowed', status=403)

    # ---- phone ----

    @api.model
    def _liwan_phone_country(self):
        """The country a number without a prefix is read in: the setting, else the root company's, else Saudi Arabia."""
        setting = self.env['liwan.customers.settings']._liwan_current().phone_country_id
        if setting:
            return setting
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return root.country_id.with_env(self.env) or self.env.ref(DEFAULT_PHONE_COUNTRY)

    @api.model
    def _liwan_normalize_phone(self, raw, channel=False, country=None):
        """The E.164 form of ``raw``, or 422 ``invalid_phone`` on ``phone``.

        ``channel`` reads a messaging address (a WhatsApp number has no ``+``) as international. A number without a
        prefix is read in ``country``, else in the tenant's phone country.
        """
        if not isinstance(raw, str) or not raw.strip():
            _refuse_phone()
        number = raw.translate(ARABIC_DIGITS).strip()
        if channel and not number.startswith('+'):
            number = f'+{number}'
        country = country or self._liwan_phone_country()
        try:
            return phone_format(number, country.code, country.phone_code, force_format='E164', raise_exception=True)
        except UserError:
            _refuse_phone()

    # ---- reads ----

    @api.model
    def _liwan_candidates(self, phone, channel=False):
        """The active parties the caller can see whose phone is ``phone``, for a pick holder."""
        self._liwan_require_pick()
        number = self._liwan_normalize_phone(phone, channel=channel)
        return self.env['res.partner'].search(
            [('liwan_party', '=', True), ('phone_sanitized', '=', number)], order='name, id',
        )

    @api.model
    def _liwan_customer(self, customer_id, include_archived=False):
        """The party ``customer_id`` the caller can see (an archived one too with ``include_archived``), else 404."""
        partners = self.env['res.partner'].with_context(active_test=not include_archived)
        customer = partners.search([('id', '=', customer_id), ('liwan_party', '=', True)], limit=1)
        if not customer:
            code = 'not_found'
            raise LiwanAccessRule(code, 'the customer does not exist', status=404)
        return customer.with_context(active_test=True)

    @api.model
    def _liwan_directory_domain(self, query=None, archived=False, filters=()):
        """The domain of the directory list: the parties of one state matching ``query`` on name, phone or email, and
        the ``filters`` (domain leaves, such as the custom field filters)."""
        domain = [('liwan_party', '=', True), ('active', '=', not archived), *filters]
        if query:
            matches = [('name', 'ilike', query), ('phone', 'ilike', query), ('email', 'ilike', query)]
            number = self._liwan_phone_or_none(query)
            if number:
                matches.append(('phone_sanitized', '=', number))
            domain += ['|'] * (len(matches) - 1) + matches
        return domain

    @api.model
    def _liwan_search(self, query=None, archived=False, limit=50, offset=0, filters=()):
        """``(parties, total)`` the caller can see, for ``_liwan_directory_domain``."""
        domain = self._liwan_directory_domain(query, archived, filters)
        partners = self.env['res.partner'].with_context(active_test=False)
        return partners.search(domain, order=ORDER, limit=limit, offset=offset), partners.search_count(domain)

    @api.model
    def _liwan_export_count(self, query=None, archived=False, filters=()):
        """How many parties ``_liwan_export_parties`` returns, counted without loading them."""
        domain = self._liwan_directory_domain(query, archived, filters)
        return self.env['res.partner'].with_context(active_test=False).search_count(domain)

    @api.model
    def _liwan_export_parties(self, query=None, archived=False, filters=()):
        """Every party the caller can see for ``_liwan_directory_domain``, in the order of the list."""
        domain = self._liwan_directory_domain(query, archived, filters)
        return self.env['res.partner'].with_context(active_test=False).search(domain, order=ORDER)

    @api.model
    def _liwan_phone_or_none(self, raw, country=None):
        """The E.164 form of ``raw`` when it is a valid phone, else None: a search text or a legacy number may be
        something else, and is then simply not read as a phone."""
        try:
            return self._liwan_normalize_phone(raw, country=country)
        except LiwanAccessRule:
            return None

    # ---- writes ----

    @api.model
    def _liwan_resolve(self, customer_id=None, values=None, create_new=False):
        """The party an action works on.

        With ``customer_id``: that active party, or 404. With ``values``: a new party, unless parties with the same
        phone exist and ``create_new`` is false, which answers 409 ``conflict`` with ``details.candidates``.
        """
        self._liwan_require_pick()
        if customer_id is not None:
            return self._liwan_customer(customer_id)
        values = values or {}
        if values.get('phone') and not create_new:
            found = self._liwan_candidates(values['phone'])
            if found:
                code = 'conflict'
                raise LiwanAccessRule(
                    code, 'customers with this phone exist', status=409,
                    details={'candidates': [self._liwan_candidate_ref(partner) for partner in found]},
                )
        return self._liwan_create(values)

    @api.model
    def _liwan_candidate_ref(self, partner):
        """What a pick holder may see of a party: its name and the last four digits of its phone (E.164, so digits)."""
        number = partner.phone_sanitized
        return {'id': partner.id, 'name': partner.name, 'phone_last4': number[-4:] if number else None}

    @api.model
    def _liwan_create(self, values):
        """A new party from ``values`` (``name`` required; ``phone``, ``email``, ``is_company``, ``parent_id``,
        ``properties``)."""
        company = self._liwan_new_company()
        vals = self._liwan_identity_values(values, required=True, company=company)
        vals.update(liwan_party=True, company_id=company.id)
        with marked(self.env, {PARTY_CREATE_MARKER: [self.env.uid]}):
            return self.env['res.partner'].create(vals)

    @api.model
    def _liwan_check_party_kind(self, values):
        """422 ``invalid`` (``details.reason`` ``party_kind_not_allowed``) on ``is_company`` when a new top-level
        customer is not one of the kinds the tenant serves (``party_kinds``). A contact under a company is always
        accepted. For the directory's create route: customers an application creates inside its own action and every
        edit are not checked, because the setting decides the forms of new customers and never changes existing data."""
        kinds = self.env['liwan.customers.settings']._liwan_current().party_kinds
        if kinds == 'both' or values.get('parent_id') is not None:
            return
        if bool(values.get('is_company')) != (kinds == 'companies'):
            code = 'invalid'
            raise LiwanAccessRule(
                code, f'this tenant serves {kinds} only', field='is_company', status=422,
                details={'reason': 'party_kind_not_allowed'},
            )

    @api.model
    def _liwan_new_company(self):
        """The company a new party gets from the sharing setting: none (shared), or the current branch."""
        sharing = self.env['liwan.customers.settings']._liwan_current().sharing
        return self.env.company if sharing == 'branch' else self.env['res.company']

    @api.model
    def _liwan_update(self, customer, values):
        """Write the ``values`` given on ``customer`` (a party from ``_liwan_customer``); ``properties`` changes only
        the custom fields it names."""
        vals = self._liwan_identity_values(values, required=False, customer=customer, company=customer.company_id)
        if vals:
            self._liwan_write(customer, vals)
        return customer

    @api.model
    def _liwan_archive(self, customer):
        self._liwan_write(customer, {'active': False})
        return customer

    @api.model
    def _liwan_restore(self, customer):
        self._liwan_write(customer, {'active': True})
        return customer

    @api.model
    def _liwan_write(self, customer, vals):
        with marked(self.env, {PARTY_MARKER: customer.ids}):
            customer.write(vals)

    @api.model
    def _liwan_identity_values(self, values, required, company, customer=None):
        """The ``res.partner`` values of the identity ``values`` of a party owned by ``company`` (empty when shared):
        checked, the phone normalised."""
        unknown = sorted(set(values) - CUSTOMER_KEYS)
        if unknown:
            _refuse_invalid(unknown[0], f'{unknown[0]} is not a customer field')
        vals = {}
        if required or 'name' in values:
            name = values.get('name')
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX:
                _refuse_invalid('name', f'name is required, at most {NAME_MAX} characters')
            vals['name'] = name.strip()
        # None clears a field; any other value must be valid.
        if 'phone' in values:
            phone = values['phone']
            vals['phone'] = False if phone is None else self._liwan_normalize_phone(phone)
        if 'email' in values:
            email = values['email']
            if email is not None and (
                not isinstance(email, str) or len(email) > EMAIL_MAX or not email_normalize(email)
            ):
                _refuse_invalid('email', 'email is not a valid address')
            vals['email'] = False if email is None else email.strip()
        if 'is_company' in values:
            vals['is_company'] = bool(values['is_company'])
        if 'parent_id' in values:
            parent_id = values['parent_id']
            vals['parent_id'] = False if parent_id is None else self._liwan_parent(parent_id, company, customer).id
        if 'properties' in values:
            vals[PROPERTIES_FIELD] = self._liwan_property_values(values['properties'], customer)
        return vals

    @api.model
    def _liwan_property_values(self, given, customer=None):
        """The value object to store: ``given`` (``{key: value}``, null clears a field) checked against the tenant's
        customer fields. The engine stores one object for the whole field, so an edit carries over the customer's other
        values."""
        parsed = parse_values(given, self.env['res.partner']._liwan_party_properties_definition())
        if not customer:
            return parsed
        values = {item['name']: item.get('value') for item in read_items(customer, PROPERTIES_FIELD)}
        return {**values, **parsed}

    @api.model
    def _liwan_parent(self, parent_id, company, customer=None):
        """A parent is an active company party the caller can see, never the customer itself, shared with at least
        everyone the customer is shared with: its company is unset or the customer's ``company``."""
        parent = self.env['res.partner'].search(
            [('id', '=', parent_id), ('liwan_party', '=', True), ('is_company', '=', True)], limit=1,
        )
        if not parent or parent == customer:
            _refuse_invalid('parent_id', 'the parent must be a company customer')
        if parent.company_id and parent.company_id != company:
            _refuse_invalid('parent_id', 'the parent must be shared with the customer')
        return parent

    # ---- migrations ----

    @api.model
    def _liwan_adopt(self, partners):
        """Make the partners a consumer created before this service into parties: ``(adopted, skipped)``.

        For a consumer's migration, which runs as the superuser. A family is decided at its root, the given partner
        whose parent is not given too: it is adopted with every contact under it when none of them is a user's
        partner, a company's partner or an employee work contact, and its parent, if any, is already a party.
        An adopted partner loses its company (establishment is the default sharing) and its phone is normalised in the
        partner's country, else the tenant's; a phone that does not validate moves into the partner's internal note.
        """
        if not self.env.is_superuser():
            msg = 'use_liwan_customers_migration: adopting partners runs in a migration'
            raise AccessError(msg)
        partners = partners.with_context(active_test=False)
        roots = partners.filtered(lambda partner: partner.parent_id not in partners)
        families = {root: partners.search([('id', 'child_of', root.id)]) for root in roots}
        everyone = partners.browse().union(*families.values())
        company_partners = self.env['res.company']._liwan_company_partner_ids(everyone.ids)
        excluded = everyone.filtered(
            lambda partner: partner.user_ids or partner.employee or partner.id in company_partners,
        )
        adopted = partners.browse()
        for root, family in families.items():
            parent = root.parent_id
            if not (family & excluded or (parent and not parent.liwan_party)):
                adopted |= family
        for partner in adopted:
            partner.write({'liwan_party': True, 'company_id': False, **self._liwan_adopted_phone(partner)})
        return adopted.with_context(active_test=True), (partners - adopted).with_context(active_test=True)

    @api.model
    def _liwan_adopted_phone(self, partner):
        """The phone values of an adopted partner: its number in E.164, or none with the number kept in its note."""
        if not partner.phone:
            return {}
        number = self._liwan_phone_or_none(partner.phone, country=partner.country_id or None)
        if number:
            return {'phone': number}
        return {'phone': False, 'comment': LEGACY_PHONE_NOTE % partner.phone + (partner.comment or '')}
