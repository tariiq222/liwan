# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import parse_day, require_capability
from .statement_support import parse_required_day
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.mis import (
    dump_zakat_adjustment,
    dump_zakat_review,
)
from odoo.addons.webvue_finance.serializers.parsing import (
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)

KINDS = ('add', 'deduct')


def _adjustment(adjustment_id):
    item = request.env['webvue.finance.zakat.adjustment'].search(
        [('id', '=', adjustment_id), ('company_id', '=', request.env.company.id)], limit=1,
    )
    if not item:
        raise MissingError(request.env._('webvue.finance.zakat.adjustment %(id)s does not exist', id=adjustment_id))
    return item


class FinanceZakatController(http.Controller):
    """The company's own figures of the Zakat workpaper (adjustments) and the accountant's reviews of it.

    Nothing here files a return: the Zakat computation stays management information until a qualified person has reviewed
    it, and even then it is the taxpayer who files with ZATCA.
    """

    @http.route('/api/v1/finance/zakat/adjustments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_adjustments(self, **_):
        require_capability('finance.zakat.read')
        date_to = parse_required_day('date_to')
        items = request.env['webvue.finance.zakat']._webvue_adjustments(request.env.company, date_to)
        return {'items': [dump_zakat_adjustment(item) for item in items], 'total': len(items)}

    @http.route('/api/v1/finance/zakat/adjustments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_adjustment(self, **payload):
        """Adds (``add``) or deducts (``deduct``) a figure of the company to the Zakat base of the fiscal year ending ``date_to``."""
        require_capability('finance.zakat.manage')
        reject_unknown(payload, {'date_to', 'kind', 'label', 'amount', 'note'})
        require_keys(payload, ('date_to', 'kind', 'label', 'amount'))
        if payload['kind'] not in KINDS:
            raise ApiError(422, 'invalid', f'kind must be one of {", ".join(KINDS)}', field='kind')
        values = {
            'company_id': request.env.company.id, 'date_to': parse_day(payload['date_to'], 'date_to'), 'kind': payload['kind'],
            'label': parse_text(payload['label'], 'label', required=True),
            'amount': parse_number(payload['amount'], 'amount', minimum=0, exclusive_minimum=True),
        }
        if 'note' in payload:
            values['note'] = parse_text(payload['note'], 'note')
        item = request.env['webvue.finance.zakat.adjustment'].create(values)
        request.env['webvue.finance.audit.event']._webvue_log('zakat_adjustment_added', item, outcome=f'{item.kind} {item.amount}')
        return request.make_json_response(dump_zakat_adjustment(item), status=201)

    @http.route('/api/v1/finance/zakat/adjustments/<int:adjustment_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def delete_adjustment(self, adjustment_id, **_):
        require_capability('finance.zakat.manage')
        item = _adjustment(adjustment_id)
        outcome = f'{item.kind} {item.amount}'
        request.env['webvue.finance.audit.event']._webvue_log('zakat_adjustment_removed', item, outcome=outcome)
        item.unlink()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/finance/zakat/reviews', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_reviews(self, **_):
        require_capability('finance.zakat.read')
        date_to = parse_required_day('date_to')
        company = request.env.company
        zakat = request.env['webvue.finance.zakat']
        _template, _amounts, figures = zakat._webvue_template_figures(company, date_to)
        adjustments = zakat._webvue_adjustments(company, date_to)
        fingerprint = zakat._webvue_fingerprint(figures, adjustments)
        reviews = request.env['webvue.finance.zakat.review'].search([('company_id', '=', company.id), ('date_to', '=', date_to)])
        return {'items': [dump_zakat_review(review, review.fingerprint == fingerprint) for review in reviews], 'total': len(reviews)}

    @http.route('/api/v1/finance/zakat/reviews', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_review(self, **payload):
        """Records that the caller reviewed the computation of the fiscal year ending ``date_to`` as it stands now.

        The caller states their credential; the row keeps the reviewed figures and a fingerprint, so any later change of the
        books or the adjustments shows the review as stale. A review is never edited or removed.
        """
        require_capability('finance.zakat.review')
        reject_unknown(payload, {'date_to', 'credential', 'note'})
        require_keys(payload, ('date_to', 'credential'))
        date_to = parse_day(payload['date_to'], 'date_to')
        company = request.env.company
        zakat = request.env['webvue.finance.zakat']
        _template, _amounts, figures = zakat._webvue_template_figures(company, date_to)
        _adjustments, base, zakat_due, _review, fingerprint = zakat._webvue_workpaper(company, date_to, figures)
        values = {
            'company_id': company.id, 'date_to': date_to, 'base': base, 'zakat_due': zakat_due, 'fingerprint': fingerprint,
            'credential': parse_text(payload['credential'], 'credential', required=True),
        }
        if 'note' in payload:
            values['note'] = parse_text(payload['note'], 'note')
        review = request.env['webvue.finance.zakat.review'].create(values)
        request.env['webvue.finance.audit.event']._webvue_log('zakat_reviewed', review, outcome=f'base {base}')
        return request.make_json_response(dump_zakat_review(review, True), status=201)
