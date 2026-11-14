# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models
from odoo.tools import html2plaintext, plaintext2html

from .access_service import DISCOUNTS_APPROVE, QUOTATIONS_MANAGE
from .sale_order import DISCOUNT_BOUNDS, LINE_KINDS, valid_discount
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_products.models.products_service import (
    QUANTITY_BOUNDS,
    valid_quantity,
)

DISPLAY_TYPES = {'product': False, 'section': 'line_section', 'note': 'line_note'}
# The stock method of each transition of the state table (D1).
TRANSITIONS = {
    'confirm': 'action_confirm',
    'cancel': 'action_cancel',
    'reopen': 'action_draft',
    'lock': 'action_lock',
    'unlock': 'action_unlock',
}
QUIET = {'mail_auto_subscribe_no_notify': True}


def _invalid(field, message):
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=field, status=422)


def _forbidden(message, field=None, details=None):
    code = 'forbidden'
    raise LiwanAccessRule(code, message, field=field, status=403, details=details)


class LiwanSalesService(models.AbstractModel):
    """The write side of Sales: staff quotations on stock ``sale.order``.

    Callers pass values already parsed by ``serializers/order.py``. A line entry is
    ``{index, id, kind, product_id, name, quantity, discount}``. Every refusal is a ``LiwanAccessRule``.
    """

    _name = 'liwan.sales.service'
    _description = 'LiwanOS Sales service'

    # ---- documents ----

    @api.model
    def _liwan_order(self, order_id):
        """The order ``order_id`` the caller reads in the working company, else 404."""
        domain = self.env['liwan.sales.visibility']._liwan_domain(self.env.user)
        order = self.env['sale.order'].search([*domain, ('id', '=', order_id)], limit=1)
        if not order:
            code = 'not_found'
            raise LiwanAccessRule(code, 'order not found', status=404)
        return order

    @api.model
    def _liwan_writable(self, order_id, action):
        """The order, once the caller may do ``action`` on it: 404 unreadable, 403 ``forbidden`` not theirs to write,
        403 ``transition_forbidden`` when the state table refuses the move."""
        order = self._liwan_order(order_id)
        self.env['liwan.sales.visibility']._liwan_check_write(order, self.env.user)
        if not order._liwan_actions(self.env.user)[action]:
            code = 'transition_forbidden'
            raise LiwanAccessRule(code, f'{action} is not allowed in this state', status=403)
        return order

    @api.model
    def _liwan_create(self, values):
        """A draft staff quotation of the working company from parsed ``values``."""
        company = self.env.company
        customer = self._liwan_customer(values['customer_id'], company)
        salesperson = self._liwan_salesperson(values.get('salesperson_id'), company, self.env.user)
        settings = self.env['liwan.sales.settings']._liwan_current()
        plan = self._liwan_line_plan(values['lines'], self.env['sale.order.line'], company, customer)
        if 'validity_date' in values:
            validity = self._liwan_validity(values['validity_date'])
        else:
            days = settings.validity_days
            validity = fields.Date.context_today(self) + timedelta(days=days) if days else False
        # Stock defaults the validity, the note and the signature from the company: each is written here.
        order = self.env['sale.order'].with_context(**QUIET).create({
            'partner_id': customer.id,
            'company_id': company.id,
            'user_id': salesperson.id,
            'liwan_staff_document': True,
            'require_signature': False,
            'require_payment': False,
            'validity_date': validity,
            'note': self._liwan_note(values.get('terms', settings.default_terms)),
        })
        self._liwan_write_lines(order, plan)
        return order

    @api.model
    def _liwan_update(self, order_id, values):
        """Write parsed ``values`` on the caller's draft ``order_id``; ``lines`` replaces the whole list."""
        order = self._liwan_writable(order_id, 'edit')
        header = {}
        if 'salesperson_id' in values:
            header['user_id'] = self._liwan_salesperson(values['salesperson_id'], order.company_id, order.user_id).id
        customer = order.partner_id
        if 'customer_id' in values:
            customer = self._liwan_customer(values['customer_id'], order.company_id)
            header['partner_id'] = customer.id
        retax = customer != order.partner_id
        # An edit that leaves the stored date as it is saves even after the date has passed; only a changed date is checked.
        if 'validity_date' in values and (values['validity_date'] or False) != (order.validity_date or False):
            header['validity_date'] = self._liwan_validity(values['validity_date'])
        if 'terms' in values:
            header['note'] = self._liwan_note(values['terms'])
        plan = None
        if 'lines' in values:
            plan = self._liwan_line_plan(values['lines'], order.order_line, order.company_id, customer)
        if header:
            order.with_context(**QUIET).write(header)
        self._liwan_write_lines(order, plan, retax=retax)
        return order

    @api.model
    def _liwan_transition(self, order_id, action):
        """Move the order by the stock method of ``action`` (``TRANSITIONS``), in the caller's environment."""
        order = self._liwan_writable(order_id, action)
        if action == 'confirm' and not order.order_line.filtered(lambda line: not line.display_type):
            _invalid('lines', 'an order needs a product line to be confirmed')
        getattr(order, TRANSITIONS[action])()
        return order

    @api.model
    def _liwan_duplicate(self, order_id):
        """A new draft of the caller built from the readable order ``order_id`` through the create path (D9).

        A product line of quantity zero is a removed line and is skipped; every other copied quantity and discount meets
        the bounds of a write, and a combo line is refused (422 on its ``product_id``).
        """
        source = self._liwan_order(order_id)
        lines = source._get_copiable_order_lines().filtered(
            lambda line: not line._is_global_discount() and (line.display_type or line.product_uom_qty),
        )
        entries = []
        for index, line in enumerate(lines):
            entry = {'index': index, 'id': None, 'kind': LINE_KINDS[line.display_type], 'name': line.name}
            if entry['kind'] == 'product':
                field = f'lines.{index}'
                if line.combo_item_id or line.product_id.type == 'combo':
                    _invalid(f'{field}.product_id', 'a combo line cannot be duplicated')
                if not valid_quantity(line.product_uom_qty):
                    _invalid(f'{field}.quantity', QUANTITY_BOUNDS)
                if not valid_discount(line.discount):
                    _invalid(f'{field}.discount_percent', DISCOUNT_BOUNDS)
                entry.update(
                    product_id=line.product_id.product_tmpl_id.id, quantity=line.product_uom_qty, discount=line.discount,
                )
            entries.append(entry)
        terms = html2plaintext(source.note) if source.note else ''
        return self._liwan_create({'customer_id': source.partner_id.id, 'lines': entries, 'terms': terms})

    @api.model
    def _liwan_assign(self, order_id, salesperson_id):
        """Give the staff document ``order_id`` to ``salesperson_id``, in any state."""
        order = self._liwan_writable(order_id, 'assign')
        salesperson = self._liwan_eligible(salesperson_id, order.company_id)
        order.with_context(**QUIET).write({'user_id': salesperson.id})
        return order

    # ---- people ----

    @api.model
    def _liwan_salespeople(self, company, query=None):
        """The internal users of ``company`` who hold ``sales.quotations.manage`` there, by name."""
        return self.env['liwan.access.service']._liwan_users_with_capability(company, QUOTATIONS_MANAGE, query)

    @api.model
    def _liwan_eligible(self, user_id, company):
        """The salesperson ``user_id`` when they may own a quotation of ``company``, else 422."""
        user = self._liwan_salespeople(company).filtered(lambda salesperson: salesperson.id == user_id)
        if not user:
            _invalid('salesperson_id', 'the salesperson does not manage quotations in this company')
        return user

    @api.model
    def _liwan_salesperson(self, user_id, company, current):
        """The salesperson a write gives the document: ``current`` unless another is named, which needs assign."""
        if user_id is None or user_id == current.id:
            return current
        if not self.env['liwan.sales.visibility']._liwan_can_assign(self.env.user, company):
            _forbidden('only an assign holder names another salesperson', field='salesperson_id')
        return self._liwan_eligible(user_id, company)

    # ---- values ----

    @api.model
    def _liwan_customer(self, customer_id, company):
        """The customer service's party ``customer_id`` usable in ``company``, else 422 on ``customer_id``."""
        try:
            customer = self.env['liwan.customers.service']._liwan_resolve(customer_id=customer_id)
        except LiwanAccessRule as error:
            if error.status == 404:
                _invalid('customer_id', 'the customer does not exist')
            raise
        if customer.company_id and customer.company_id not in company.parent_ids:
            _invalid('customer_id', 'the customer belongs to another company')
        return customer

    @api.model
    def _liwan_product(self, product_id, company, field):
        """The product service's product ``product_id`` usable in ``company``, else 422 on ``field``."""
        try:
            product = self.env['liwan.products.service']._liwan_pick_product(product_id)
        except LiwanAccessRule as error:
            if error.status == 404:
                _invalid(field, 'the product does not exist')
            raise
        if product.company_id and product.company_id not in company.parent_ids:
            _invalid(field, 'the product belongs to another company')
        # A line names a template and takes its one variant; products with variants come with a later pull request.
        if len(product.product_variant_ids) > 1:
            _invalid(field, 'products with variants are not supported yet')
        return product

    @api.model
    def _liwan_validity(self, value):
        if value and value < fields.Date.context_today(self):
            _invalid('validity_date', 'the validity date is in the past')
        return value or False

    @api.model
    def _liwan_note(self, text):
        return plaintext2html(text) if text else ''

    # ---- lines ----

    @api.model
    def _liwan_line_plan(self, entries, existing, company, customer):
        """``[(line or None, vals)]`` for the line ``entries`` after every check, ``existing`` being the order's
        lines. Every product line write carries ``price_unit`` (D6): stock would otherwise reprice it from the list
        price on a quantity change."""
        limit = self.env['liwan.sales.settings']._liwan_current().discount_limit_percent
        approves = DISCOUNTS_APPROVE in self.env['liwan.sales.visibility']._liwan_keys(self.env.user, company)
        plan = []
        seen = set()
        for sequence, entry in enumerate(entries):
            field = f"lines.{entry['index']}"
            line = self._liwan_known_line(entry, existing, seen, field)
            vals = {'sequence': sequence}
            if entry['name']:
                vals['name'] = entry['name']
            if entry['kind'] != 'product':
                if not line:
                    vals['display_type'] = DISPLAY_TYPES[entry['kind']]
                plan.append((line, vals))
                continue
            product = self._liwan_product(entry['product_id'], company, f'{field}.product_id')
            variant = product.product_variant_id
            vals.update(product_uom_qty=entry['quantity'], discount=entry['discount'])
            if line and line.product_id == variant:
                vals['price_unit'] = line.price_unit
            else:
                price = self.env['liwan.products.service']._liwan_price(
                    product, quantity=entry['quantity'], company=company, customer=customer,
                )
                vals.update(product_id=variant.id, price_unit=price['unit_price'])
            # A stored discount above the limit stays only on a line left as it was (D7); any edited line is checked.
            unchanged = line and (line.product_id, line.product_uom_qty, line.discount) == (
                variant, entry['quantity'], entry['discount'],
            )
            if limit and entry['discount'] > limit and not approves and not unchanged:
                _forbidden(
                    f'a discount above {limit}% needs {DISCOUNTS_APPROVE}', field=f'{field}.discount_percent',
                    details={'reason': 'discount_above_limit'},
                )
            plan.append((line, vals))
        return plan

    @api.model
    def _liwan_known_line(self, entry, existing, seen, field):
        """The existing line an entry names by ``id`` (None for a new one), else 422."""
        if entry['id'] is None:
            return None
        line = existing.filtered(lambda candidate: candidate.id == entry['id'])
        if not line or entry['id'] in seen:
            _invalid(f'{field}.id', 'the line is not a line of this order')
        seen.add(entry['id'])
        if LINE_KINDS[line.display_type] != entry['kind']:
            _invalid(f'{field}.kind', 'the kind of a line cannot change')
        return line

    @api.model
    def _liwan_write_lines(self, order, plan, retax=False):
        """Apply ``plan`` (None: keep the lines) and, with ``retax``, recompute the lines' taxes.

        D17: elevated with the order's company, because a branch session cannot write ``sale.order.line.tax_ids``
        (the branch fence hides the root's ``account.tax``). Only called after the caller's capability, visibility,
        ownership, state, customer, product and discount checks. Records go back in the caller's environment.
        """
        elevated = order.sudo().with_company(order.company_id)
        if plan is not None:
            kept = {line.id for line, _vals in plan if line}
            (elevated.order_line.filtered(lambda line: line.id not in kept)).unlink()
            Line = elevated.env['sale.order.line']
            for line, vals in plan:
                if line:
                    line.with_env(elevated.env).write(vals)
                else:
                    Line.create({**vals, 'order_id': order.id})
        if retax:
            elevated._recompute_taxes()
        elevated.env.flush_all()
        order.invalidate_recordset()
        order.order_line.invalidate_recordset()
        return order
