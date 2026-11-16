# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models
from odoo.tools import html2plaintext, plaintext2html

from .access_service import SETTINGS_MANAGE
from .sale_order import LINE_KINDS
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

DISPLAY_TYPES = {'product': False, 'section': 'line_section', 'note': 'line_note'}
# A template keeps its text in one language whatever the language of the screen that writes or reads it, because the
# stock fields that hold it (terms, line description) are translated and a write in one language leaves the others behind.
TEMPLATE_LANG = 'en_US'
ORDER = 'name, id'


def _invalid(field, message):
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=field, status=422)


def _refused_move(message):
    code = 'transition_forbidden'
    raise LiwanAccessRule(code, message, status=403)


class LiwanSalesTemplate(models.AbstractModel):
    """Quotation templates: stock ``sale.order.template`` made, listed and used by Sales staff.

    A template belongs to the company it was made in (stock ``company_id``) and serves that company's quotations only.
    Managing one needs ``sales.settings.manage`` in that company, reading the pick list and starting a quotation from
    one needs ``sales.quotations.manage``. It holds no price and no tax: starting a quotation turns its lines into the
    entries of a hand-made quotation, which the create path prices and taxes now. Callers pass values already parsed by
    ``serializers/template.py``; every refusal is a ``LiwanAccessRule``.
    """

    _name = 'liwan.sales.template'
    _description = 'LiwanOS Sales quotation templates'

    # ---- reads ----

    @api.model
    def _liwan_model(self):
        return self.env['sale.order.template'].with_context(lang=TEMPLATE_LANG)

    @api.model
    def _liwan_can_manage(self, company=None):
        """Whether the caller holds ``sales.settings.manage`` in ``company`` (default: the working company)."""
        keys = self.env['liwan.sales.visibility']._liwan_keys(self.env.user, company or self.env.company)
        return SETTINGS_MANAGE in keys

    @api.model
    def _liwan_search(self, query=None, archived=False, limit=50, offset=0):
        """``(templates, total)`` of the working company, by name; an archived list is for a manager only (403)."""
        if archived and not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'only a settings manager lists archived templates', status=403)
        domain = [('company_id', '=', self.env.company.id), ('active', '=', not archived)]
        if query:
            domain.append(('name', 'ilike', query))
        templates = self._liwan_model().with_context(active_test=False)
        return templates.search(domain, order=ORDER, limit=limit, offset=offset), templates.search_count(domain)

    @api.model
    def _liwan_template(self, template_id, archived=None):
        """The template ``template_id`` of the working company, else 404. An archived one is found only by a manager and
        only with ``archived`` not False; ``archived=False`` finds active templates only (what starts a quotation)."""
        templates = self._liwan_model().with_context(active_test=False)
        domain = [('id', '=', template_id), ('company_id', '=', self.env.company.id)]
        if archived is False or not self._liwan_can_manage():
            domain.append(('active', '=', True))
        template = templates.search(domain, limit=1)
        if not template:
            code = 'not_found'
            raise LiwanAccessRule(code, 'template not found', status=404)
        return template

    @api.model
    def _liwan_usable_product_ids(self, templates):
        """The ids of the products among the product lines of ``templates`` that a quotation of the working company can take.

        One search and one variant read for the whole page of templates, whatever the number of lines. A product is usable
        by the rules of ``liwan.products.service._liwan_usable_product``: active, of the product service, shared or
        owned by the company or an ancestor, and with one variant. The caller must be a pick holder (403) when any
        template holds a product line.
        """
        ids = {
            line.product_id.product_tmpl_id.id
            for line in templates.sale_order_template_line_ids if not line.display_type
        }
        ids.discard(False)
        if not ids:
            return set()
        self.env['liwan.products.service']._liwan_require_pick()
        products = self.env['product.template'].search([('id', 'in', list(ids)), ('liwan_product', '=', True)])
        owned = products.company_id
        # The company's ancestors are read only when a product is owned by one: a branch user may not read the root company.
        parents = self.env.company.parent_ids if owned else owned
        return {
            product.id for product in products.with_context(active_test=False)
            if (not product.company_id or product.company_id in parents) and len(product.product_variant_ids) <= 1
        }

    # ---- writes ----

    @api.model
    def _liwan_create(self, values):
        """A new active template of the working company from parsed ``values`` (``name`` required)."""
        self._liwan_require_manage()
        lines = self._liwan_line_commands(values.get('lines', []))
        return self._liwan_model().create({
            'name': values['name'],
            'company_id': self.env.company.id,
            'number_of_days': values.get('validity_days', 0),
            'note': self._liwan_note(values.get('terms', '')),
            'sale_order_template_line_ids': lines,
        })

    @api.model
    def _liwan_update(self, template_id, values):
        """Write parsed ``values`` on the active template ``template_id``; ``lines`` replaces the whole list."""
        self._liwan_require_manage()
        template = self._liwan_template(template_id)
        if not template.active:
            _refused_move('an archived template is restored before it is edited')
        header = {}
        if 'name' in values:
            header['name'] = values['name']
        if 'validity_days' in values:
            header['number_of_days'] = values['validity_days']
        if 'terms' in values:
            header['note'] = self._liwan_note(values['terms'])
        if 'lines' in values:
            header['sale_order_template_line_ids'] = [Command.clear(), *self._liwan_line_commands(values['lines'])]
        template.write(header)
        return template

    @api.model
    def _liwan_set_active(self, template_id, active):
        """Archive (``active`` False) or restore the template; 403 ``transition_forbidden`` when it is already so."""
        self._liwan_require_manage()
        template = self._liwan_template(template_id)
        if template.active == active:
            _refused_move('the template is already ' + ('active' if active else 'archived'))
        template.write({'active': active})
        return template

    @api.model
    def _liwan_require_manage(self):
        if not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'templates are managed by a settings manager', status=403)

    @api.model
    def _liwan_note(self, text):
        return plaintext2html(text) if text else ''

    @api.model
    def _liwan_line_commands(self, entries):
        """The ``Command.create`` of each parsed line entry ``{index, kind, product_id, name, quantity}``, in order.

        A product line names a product of the product service that the working company can take (its one variant) and
        that stock lets this template hold: a product of another company cannot sit in a template (stock's company
        check), so it is refused here with the same 422 instead of a server error.
        """
        company = self.env.company
        commands = []
        for sequence, entry in enumerate(entries):
            vals = {'sequence': sequence, 'display_type': DISPLAY_TYPES[entry['kind']]}
            if entry['kind'] != 'product':
                if entry['name']:
                    vals['name'] = entry['name']
            else:
                field = f"lines.{entry['index']}.product_id"
                product = self.env['liwan.products.service']._liwan_usable_product(entry['product_id'], company, field)
                if product.company_id and product.company_id != company:
                    _invalid(field, 'a template holds only products shared by every company or owned by its own company')
                own = self._liwan_own_text(product.product_variant_id, entry['name'])
                if own:
                    vals['name'] = own
                vals.update(product_id=product.product_variant_id.id, product_uom_qty=entry['quantity'])
            commands.append(Command.create(vals))
        return commands

    # ---- starting a quotation ----

    @api.model
    def _liwan_own_text(self, variant, text):
        """The text staff wrote for a product line of ``variant``, or None when it is empty or only the product's default
        description in ``TEMPLATE_LANG``.

        A copy of the default description (stale after a rename, in the wrong language for the customer) is neither
        stored nor passed on, so the quotation line takes the current product text in the language of its own document.
        """
        text = (text or '').strip()
        default = (variant.with_context(lang=TEMPLATE_LANG).get_product_multiline_description_sale() or '').strip()
        return text if text and text != default else None

    @api.model
    def _liwan_start(self, template_id, company):
        """The values a template gives a new quotation of ``company``: ``{'lines', 'terms'?, 'validity_days'?}``.

        ``lines`` are entries of the create path (``liwan.sales.service._liwan_line_plan``), so every product line is priced and taxed
        now and a product that is archived, of another company or with several variants refuses the quotation (422
        ``template_unusable`` on ``template_id``, naming the line). An archived or missing template is 422 ``invalid``
        on ``template_id``. A line stock marks optional is left out: Sales has no optional lines. ``terms`` and
        ``validity_days`` are present only when the template sets them (empty terms, zero days fall back to the settings).
        """
        template = self._liwan_model().search([('id', '=', template_id), ('company_id', '=', company.id)], limit=1)
        if not template:
            _invalid('template_id', 'the template does not exist')
        entries = []
        for line in template.sale_order_template_line_ids.sorted('sequence').filtered(lambda line: not line.is_optional):
            kind = LINE_KINDS[line.display_type]
            entry = {'index': len(entries), 'id': None, 'kind': kind, 'name': line.name or None}
            if kind == 'product':
                entry['name'] = self._liwan_own_text(line.product_id, line.name)
                tmpl = line.product_id.product_tmpl_id
                try:
                    self.env['liwan.products.service']._liwan_usable_product(tmpl.id, company, 'product_id')
                except LiwanAccessRule as error:
                    if error.status != 422:
                        raise
                    code = 'template_unusable'
                    raise LiwanAccessRule(
                        code, f'the template cannot start a quotation: {tmpl.name}, {error.message}',
                        field='template_id', status=422, details={'product': tmpl.name},
                    ) from error
                entry.update(product_id=tmpl.id, quantity=line.product_uom_qty, discount=0)
            entries.append(entry)
        start = {'lines': entries}
        if html2plaintext(template.note or '').strip():
            start['terms'] = html2plaintext(template.note).strip()
        if template.number_of_days > 0:
            start['validity_days'] = template.number_of_days
        return start
