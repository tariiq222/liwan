# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError

from .access_service import PRODUCTS_MANAGE, PRODUCTS_PRICES_MANAGE, PRODUCTS_READ
from .product_template import PRODUCT_CREATE_MARKER, PRODUCT_MARKER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_core.models.protected_write import marked

NAME_MAX = 200
DESCRIPTION_MAX = 4000
ORDER = 'name, id'
# The wire value of a product type and the stock value it stores (plan D10: combo waits for its editor).
WIRE_TYPES = {'goods': 'consu', 'service': 'service'}
STOCK_TYPES = {stock: wire for wire, stock in WIRE_TYPES.items()}
# The values of the base definition a caller may give; contributing addons add their spec names.
BASE_KEYS = frozenset({'name', 'type', 'list_price', 'description'})
PRICE_KEYS = frozenset({'list_price'})


def _refuse_invalid(field, message):
    """422 ``invalid`` on ``field``."""
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=field, status=422)


def _refuse_forbidden(message, reason=None):
    """403 ``forbidden``, with ``details.reason`` when the refusal is about where the product is managed."""
    code = 'forbidden'
    raise LiwanAccessRule(code, message, status=403, details={'reason': reason} if reason else None)


def _keys_of(values):
    """The keys of a values object, checked before anything reads the values (422 when it is not an object)."""
    if not isinstance(values, dict):
        _refuse_invalid(None, 'the product values must be an object')
    return set(values)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class LiwanProductsService(models.AbstractModel):
    """The only writer of a product's definition on ``product.template``.

    Every method runs as the caller. The write methods check the capabilities themselves (an application calling
    them from its own route cannot skip them); the technical group ``group_products_writer`` gives the right to write
    a service product, the record rules and the company fence decide which products the caller sees, and the sharing
    setting decides the company of a new one. Errors are ``LiwanAccessRule`` with the status ``api_handler`` answers.
    """
    _name = 'liwan.products.service'
    _description = 'LiwanOS products service'
    _liwan_scope = 'global'

    # ---- registry hooks: consuming applications extend them through super() ----

    @api.model
    def _liwan_products_feature_keys(self):
        """Feature keys that open /api/v1/products; the routes are open while any of them is readable."""
        return ()

    @api.model
    def _liwan_products_pick_capabilities(self):
        """Capability keys that may pick a product inside the application's own action."""
        return ()

    @api.model
    def _liwan_can_pick(self):
        """Whether the caller holds ``products.read`` or a registered pick capability in the current company."""
        service = self.env['liwan.access.service']
        return any(
            service._liwan_has_capability(self.env.user, key)
            for key in (PRODUCTS_READ, *self._liwan_products_pick_capabilities())
        )

    @api.model
    def _liwan_require_pick(self):
        """403 ``forbidden`` unless the caller may pick a product (``_liwan_can_pick``)."""
        if not self._liwan_can_pick():
            _refuse_forbidden('picking a product is not allowed')

    # ---- reads ----

    @api.model
    def _liwan_product(self, product_id, include_archived=False):
        """The service product ``product_id`` (a ``product.template``) the caller can see, an archived one too with
        ``include_archived``, else 404 ``not_found``."""
        templates = self.env['product.template'].with_context(active_test=not include_archived)
        product = templates.search([('id', '=', product_id), ('liwan_product', '=', True)], limit=1)
        if not product:
            code = 'not_found'
            raise LiwanAccessRule(code, 'the product does not exist', status=404)
        return product.with_context(active_test=True)

    @api.model
    def _liwan_search_domain(self, query=None, archived=False, type=None):
        """The service products of one state, matching ``query`` on the name and of the wire ``type`` when given."""
        domain = [('liwan_product', '=', True), ('active', '=', not archived)]
        if query:
            domain.append(('name', 'ilike', query))
        if type is not None:
            if type not in WIRE_TYPES:
                _refuse_invalid('type', f'type must be one of {sorted(WIRE_TYPES)}')
            domain.append(('type', '=', WIRE_TYPES[type]))
        return domain

    @api.model
    def _liwan_search(self, query=None, archived=False, type=None, limit=50, offset=0):
        """``(products, total)`` the caller can see for ``_liwan_search_domain``, by name."""
        domain = self._liwan_search_domain(query, archived, type)
        templates = self.env['product.template'].with_context(active_test=False)
        found = templates.search(domain, order=ORDER, limit=limit, offset=offset)
        return found.with_context(active_test=True), templates.search_count(domain)

    @api.model
    def _liwan_pick_product(self, product_id):
        """For a pick holder (403 otherwise): the active service product ``product_id`` the caller can see, else 404."""
        self._liwan_require_pick()
        return self._liwan_product(product_id)

    @api.model
    def _liwan_pick_search(self, query=None, limit=50, offset=0):
        """``(products, total)``: the active service products the caller can see, for a pick holder (403 otherwise)."""
        self._liwan_require_pick()
        return self._liwan_search(query, limit=limit, offset=offset)

    # ---- writes ----

    @api.model
    def _liwan_create(self, values):
        """A new service product from ``values`` (``name`` and ``type`` required; ``list_price``, ``description`` and
        the contributed fields optional). Needs ``products.manage``, and ``products.prices.manage`` for a price; a
        product created without one costs 0. Its company comes from the sharing setting (D7) and decides where it is
        created (D23)."""
        company = self._liwan_new_company()
        self._liwan_require_write(company, _keys_of(values))
        vals, extensions = self._liwan_definition_values(values, company, required=True)
        specs = self.env['product.template']._liwan_product_extension_specs()
        # Every contributed field starts blank, so that no stock default runs in the caller's environment; its own
        # writer then stores the value given or its default.
        for spec in specs:
            vals.update(spec['blank'])
        vals.update(liwan_product=True, company_id=company.id)
        with marked(self.env, {PRODUCT_CREATE_MARKER: [self.env.uid]}):
            product = self.env['product.template'].create(vals)
        for spec in specs:
            stored = extensions[spec['name']] if spec['name'] in extensions else spec['default'](self.env, company)
            self._liwan_write_extension(product, spec, stored)
        return product

    @api.model
    def _liwan_update(self, product, values):
        """Write the ``values`` given on ``product`` (from ``_liwan_product``): ``products.manage`` for every key but
        ``list_price``, ``products.prices.manage`` for ``list_price``, both in the company that manages it (D23)."""
        product.ensure_one()
        self._liwan_require_write(product.company_id, _keys_of(values))
        vals, extensions = self._liwan_definition_values(values, product.company_id, required=False)
        if vals:
            self._liwan_write(product, vals)
        specs = self._liwan_extension_specs()
        for name, stored in extensions.items():
            self._liwan_write_extension(product, specs[name], stored)
        return product

    @api.model
    def _liwan_archive(self, product):
        product.ensure_one()
        self._liwan_require_write(product.company_id, {'active': False})
        self._liwan_write(product, {'active': False})
        return product

    @api.model
    def _liwan_restore(self, product):
        product.ensure_one()
        self._liwan_require_write(product.company_id, {'active': True})
        self._liwan_write(product, {'active': True})
        return product

    @api.model
    def _liwan_write(self, product, vals):
        with marked(self.env, {PRODUCT_MARKER: product.ids}):
            product.write(vals)

    @api.model
    def _liwan_write_extension(self, product, spec, stored):
        """Store a contributed field through its own writer, under the service's marker."""
        with marked(self.env, {PRODUCT_MARKER: product.ids}):
            spec['write'](product, stored)

    @api.model
    def _liwan_new_company(self):
        """The company a new product gets from the sharing setting: none (shared), or the current branch."""
        sharing = self.env['liwan.products.settings']._liwan_current().sharing
        return self.env.company if sharing == 'branch' else self.env['res.company']

    @api.model
    def _liwan_require_write(self, company, values):
        """403 ``forbidden`` unless the caller may write the keys of ``values`` (a dict or a set of keys) on a product
        owned by ``company`` (empty when shared). Public: a consumer calls it before writing its own link field on a
        service product.

        D23: a shared product is managed in a root-company session, a branch's product in a session of that branch,
        and the caller holds the capability there: ``products.prices.manage`` for ``list_price``,
        ``products.manage`` for anything else.
        """
        owner = company or self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        if self.env.company != owner:
            reason = 'managed_in_branch' if company else 'managed_in_root_company'
            _refuse_forbidden('this product is managed in another company', reason)
        access = self.env['liwan.access.service']
        keys = set(values)
        required = ({PRODUCTS_PRICES_MANAGE} if keys & PRICE_KEYS else set()) | (
            {PRODUCTS_MANAGE} if keys - PRICE_KEYS else set()
        )
        for key in sorted(required):
            if not access._liwan_has_capability(self.env.user, key):
                _refuse_forbidden(f'{key} capability is required')

    @api.model
    def _liwan_extension_specs(self):
        """The contributed fields that apply to the session's establishment, by wire name."""
        specs = self.env['product.template']._liwan_product_extension_specs()
        return {spec['name']: spec for spec in specs if spec['applies'](self.env)}

    @api.model
    def _liwan_definition_values(self, values, company, required):
        """``(vals, extensions)`` of ``values`` for a product owned by ``company`` (empty when shared), checked or 422:
        the ``product.template`` values of the base definition, and the parsed value of each contributed field given,
        by wire name."""
        specs = self._liwan_extension_specs()
        unknown = sorted(set(values) - BASE_KEYS - set(specs))
        if unknown:
            _refuse_invalid(unknown[0], f'{unknown[0]} is not a product field')
        if required:
            missing = sorted({'name', 'type'} - set(values))
            if missing:
                _refuse_invalid(missing[0], f'{missing[0]} is required')
        vals = {}
        if 'name' in values:
            name = values['name']
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX:
                _refuse_invalid('name', f'name is required, at most {NAME_MAX} characters')
            vals['name'] = name.strip()
        if 'type' in values:
            if values['type'] not in WIRE_TYPES:
                _refuse_invalid('type', f'type must be one of {sorted(WIRE_TYPES)}')
            vals['type'] = WIRE_TYPES[values['type']]
        if 'list_price' in values:
            price = values['list_price']
            if not _is_number(price) or price < 0:
                _refuse_invalid('list_price', 'list_price must be a number, zero or more')
            vals['list_price'] = float(price)
        elif required:
            vals['list_price'] = 0.0
        if 'description' in values:
            description = values['description']
            if description is not None and (not isinstance(description, str) or len(description) > DESCRIPTION_MAX):
                _refuse_invalid('description', f'description must be text, at most {DESCRIPTION_MAX} characters')
            vals['description_sale'] = (description or '').strip() or False
        extensions = {
            name: spec['parse'](self.env, values[name], company) for name, spec in specs.items() if name in values
        }
        return vals, extensions

    # ---- price ----

    @api.model
    def _liwan_price(self, product, quantity=1.0, uom=None, company=None, customer=None, date=None):
        """What ``product`` costs ``customer`` for ``quantity`` in ``company`` (default: the session's), in that
        company's currency (plan D6).

        ``product`` is a ``product.template`` (its single variant is priced) or a ``product.product``. ``uom`` is the
        unit of ``quantity`` (default: the product's), ``date`` the day of the price and of any currency conversion.
        Returns ``{unit_price, amount_untaxed, amount_tax, amount_total, currency}``: the unit price as typed on the
        product (stock pricelist engine on an empty pricelist, so pricelists later change it without touching a
        caller), then the amounts for the quantity. The tax part is ``_liwan_price_amounts``, which the tax bridge
        extends; without it there is no tax. 403 unless the caller may pick a product; an elevated caller (a cron, a
        public page) is not checked and passes ``company`` explicitly. A non-elevated caller may ask only for a company of
        its session (403 otherwise). ``quantity`` is a number above zero (422 otherwise). ``unit_price`` is rounded to
        the currency; the amounts come from the unrounded unit price.
        """
        if not _is_number(quantity) or quantity <= 0:
            _refuse_invalid('quantity', 'quantity must be a number greater than zero')
        company = company or self.env.company
        if not self.env.su:
            self._liwan_require_pick()
            if company not in self.env.companies:
                _refuse_forbidden('the price is asked for a company outside the session')
        # An archived product keeps its variant archived: the price of an archived product is still shown.
        variant = (
            product.with_context(active_test=False).product_variant_ids[:1]
            if product._name == 'product.template' else product
        )
        currency = company.currency_id
        unit_price = self.env['product.pricelist'].with_company(company)._get_product_price(
            variant, quantity, currency=currency, uom=uom, date=date or False,
        )
        untaxed, tax, total = self._liwan_price_amounts(variant, unit_price, quantity, company, customer)
        return {
            'unit_price': currency.round(unit_price),
            'amount_untaxed': untaxed,
            'amount_tax': tax,
            'amount_total': total,
            'currency': currency,
        }

    @api.model
    def _liwan_price_amounts(self, variant, unit_price, quantity, company, customer):
        """``(amount_untaxed, amount_tax, amount_total)`` of ``quantity`` units of ``variant`` at ``unit_price`` in
        ``company``'s currency, for ``customer`` (a ``res.partner`` or None). The base has no tax: the tax bridge
        overrides this with the taxes stock would put on a sale line of ``company``."""
        amount = company.currency_id.round(unit_price * quantity)
        return amount, 0.0, amount

    # ---- migrations ----

    @api.model
    def _liwan_adopt(self, products):
        """Make the ``product.template`` rows a consumer created before this service into service products, shared
        (company cleared: establishment is the default sharing, plan D17). Returns the adopted templates.

        For a consumer's migration, which runs as the superuser.
        """
        if not self.env.is_superuser():
            msg = 'use_liwan_products_migration: adopting products runs in a migration'
            raise AccessError(msg)
        products = products.with_context(active_test=False)
        products.write({'liwan_product': True, 'company_id': False})
        return products.with_context(active_test=True)
