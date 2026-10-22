# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.payment_term import (
    dump_payment_term,
    dump_payment_terms,
    parse_payment_term_create,
    parse_payment_term_patch,
)


def _terms_domain():
    return ['|', ('company_id', '=', False), ('company_id', 'in', request.env.companies.ids)]


def _find_term(term_id):
    term = request.env['account.payment.term'].with_context(active_test=False).search([('id', '=', term_id), *_terms_domain()], limit=1)
    if not term:
        raise MissingError(request.env._('account.payment.term %(id)s does not exist', id=term_id))
    return term


def _find_own_term(term_id):
    """Terms without a company come with the chart and are shared by every company: they are not edited here."""
    term = _find_term(term_id)
    if not term.company_id:
        raise ApiError(422, 'shared_record', 'a payment term shared by every company cannot be changed here')
    return term


def _values(parsed):
    values = {key: parsed[key] for key in ('name', 'note') if key in parsed}
    if 'lines' in parsed:
        values['line_ids'] = [Command.clear(), *(Command.create(line) for line in parsed['lines'])]
    return values


class FinancePaymentTermController(http.Controller):

    @http.route('/api/v1/finance/payment-terms', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_payment_terms(self, **_):
        require_capability('finance.payment_terms.read')
        args = request.httprequest.args
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [*_terms_domain(), ('active', '=', not archived)]
        query = (args.get('q') or '').strip()
        if query:
            domain.append(('name', 'ilike', query))
        return list_page('account.payment.term', domain, dump_payment_terms)

    @http.route('/api/v1/finance/payment-terms/<int:term_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_payment_term(self, term_id):
        require_capability('finance.payment_terms.read')
        return dump_payment_term(_find_term(term_id))

    @http.route('/api/v1/finance/payment-terms', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_payment_term(self, **payload):
        require_capability('finance.payment_terms.manage')
        values = _values(parse_payment_term_create(payload))
        term = attempt(lambda: request.env['account.payment.term'].create({**values, 'company_id': request.env.company.id}))
        request.env['webvue.finance.audit.event']._webvue_log('payment_term_created', term, fields_written=payload)
        return request.make_json_response(dump_payment_term(term), status=201)

    @http.route('/api/v1/finance/payment-terms/<int:term_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_payment_term(self, term_id, **payload):
        require_capability('finance.payment_terms.manage')
        term = _find_own_term(term_id)
        values = _values(parse_payment_term_patch(payload))
        attempt(lambda: term.write(values))
        request.env['webvue.finance.audit.event']._webvue_log('payment_term_changed', term, fields_written=payload)
        return dump_payment_term(term)

    @http.route('/api/v1/finance/payment-terms/<int:term_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_payment_term(self, term_id, **_):
        require_capability('finance.payment_terms.manage')
        term = _find_own_term(term_id)
        attempt(term.action_archive)
        request.env['webvue.finance.audit.event']._webvue_log('payment_term_archived', term)
        return dump_payment_term(term)

    @http.route('/api/v1/finance/payment-terms/<int:term_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_payment_term(self, term_id, **_):
        require_capability('finance.payment_terms.manage')
        term = _find_own_term(term_id)
        attempt(term.action_unarchive)
        request.env['webvue.finance.audit.event']._webvue_log('payment_term_unarchived', term)
        return dump_payment_term(term)
