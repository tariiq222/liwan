# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import UserError

VAT_RETURN = 'l10n_sa.tax_report_vat_filing'
TAG_FORMULA = re.compile(r'(-?)(\d+\(([BT])\))')
TERM = re.compile(r'([+-]?)\s*(sa_\d+)\.(base|tax)')
COLUMNS = ('base', 'tax')


class LiwanFinanceVatReturn(models.AbstractModel):
    """The boxes of the Saudi VAT return, evaluated from the tax tags of the journal items.

    The return itself (``l10n_sa.tax_report_vat_filing``) is only data in Community: the engine that evaluates its tag and
    aggregation expressions ships with Enterprise. This model reads that same data and applies the engine's rule for a tag
    expression: the balance of the posted items that carry the tag, negated when the formula starts with a minus (so sales,
    which are credits, come out positive). Aggregation boxes (totals, net VAT) add and subtract boxes by their code. Every figure can
    be opened down to the items behind it with ``_liwan_items``.

    Producing the figures is not filing the return: that is done by the taxpayer on the ZATCA portal, after review.
    """
    _name = 'liwan.finance.vat.return'
    _description = 'LiwanOS finance VAT return'

    @api.model
    def _liwan_lines(self):
        report = self.env.ref(VAT_RETURN, raise_if_not_found=False)
        if not report:
            raise UserError(self.env._('The Saudi VAT return definition is not installed.'))
        return report.line_ids.sorted('sequence')

    @api.model
    def _liwan_tag_domain(self, expression, company, date_from, date_to):
        """The posted items of ``company`` in the period that carry a tag of the tag expression."""
        tags = expression._get_matching_tags()
        return [
            ('company_id', '=', company.id), ('parent_state', '=', 'posted'),
            ('date', '>=', date_from), ('date', '<=', date_to), ('tax_tag_ids', 'in', tags.ids),
        ], tags

    @api.model
    def _liwan_tag_amount(self, expression, company, date_from, date_to):
        domain, tags = self._liwan_tag_domain(expression, company, date_from, date_to)
        if not tags:
            return 0.0
        formula_sign = -1 if expression.formula.startswith('-') else 1
        total = 0.0
        groups = self.env['account.move.line']._read_group(domain, ['tax_tag_ids'], ['balance:sum'])
        for tag, balance in groups:
            if tag in tags:
                total += balance * formula_sign
        return company.currency_id.round(total)

    @api.model
    def _liwan_vat_return(self, company, date_from, date_to):
        """``[box]`` in the return's order; a box is ``{code, name, base, tax}`` with ``None`` for a column it does not have."""
        figures = {}
        boxes = []
        for line in self._liwan_lines():
            if not line.code:
                continue
            box = {'code': line.code, 'name': line.name, 'base': None, 'tax': None, 'sources': []}
            for expression in line.expression_ids:
                if expression.label not in COLUMNS:
                    continue
                if expression.engine == 'tax_tags':
                    box[expression.label] = self._liwan_tag_amount(expression, company, date_from, date_to)
                    box['sources'].append(expression.label)
                elif expression.engine == 'aggregation':
                    value = 0.0
                    for sign, code, column in TERM.findall(expression.formula):
                        value += (-1 if sign == '-' else 1) * (figures.get((code, column)) or 0.0)
                    box[expression.label] = company.currency_id.round(value)
            for column in COLUMNS:
                figures[line.code, column] = box[column]
            boxes.append(box)
        return boxes

    @api.model
    def _liwan_items(self, company, code, column, date_from, date_to):
        """The journal items behind a tag box column, as ``[(item, signed amount)]`` (empty for an aggregation box)."""
        line = self._liwan_lines().filtered(lambda item: item.code == code)
        expression = line.expression_ids.filtered(lambda item: item.label == column and item.engine == 'tax_tags')
        if not expression:
            return []
        domain, tags = self._liwan_tag_domain(expression, company, date_from, date_to)
        formula_sign = -1 if expression.formula.startswith('-') else 1
        items = self.env['account.move.line'].search(domain, order='date, id')
        rows = []
        for item in items:
            rows.append((item, company.currency_id.round(item.balance * formula_sign * len(item.tax_tag_ids & tags))))
        return rows
