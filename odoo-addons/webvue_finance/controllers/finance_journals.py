# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import list_page, parse_choice, require_capability
from .write_support import attempt, company_records, currency_id_of
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.journal import (
    dump_journal,
    dump_journals,
    parse_journal_create,
    parse_journal_patch,
)


def _journal_types():
    return request.env['account.journal']._fields['type'].get_values(request.env)


def _find_journal(journal_id):
    journal = request.env['account.journal'].with_context(active_test=False).search(
        [('id', '=', journal_id), ('company_id', 'in', request.env.companies.ids)], limit=1,
    )
    if not journal:
        raise MissingError(request.env._('account.journal %(id)s does not exist', id=journal_id))
    return journal


def _require_free_code(code, company, journal=None):
    """Odoo enforces the code with a SQL constraint, which would abort the request transaction: check it up front."""
    taken = request.env['account.journal'].with_context(active_test=False).search_count([
        ('company_id', '=', company.id), ('code', '=', code), ('id', '!=', journal.id if journal else 0),
    ], limit=1)
    if taken:
        raise ApiError(422, 'invalid', 'code is already used by another journal', field='code')


def _values(parsed, company):
    values = {key: parsed[key] for key in ('name', 'code', 'type') if key in parsed}
    if 'currency' in parsed:
        values['currency_id'] = currency_id_of(parsed['currency'])
    if 'default_account_id' in parsed:
        values['default_account_id'] = company_records(
            'account.account', [parsed['default_account_id']], 'default_account_id',
            request.env['account.account']._check_company_domain(company),
        ).id
    return values


class FinanceJournalController(http.Controller):

    @http.route('/api/v1/finance/journals', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_journals(self, **_):
        require_capability('finance.journals.read')
        args = request.httprequest.args
        archived = parse_choice(args.get('archived'), {'true', 'false'}, 'archived') == 'true'
        domain = [('company_id', 'in', request.env.companies.ids), ('active', '=', not archived)]
        journal_type = parse_choice(args.get('type'), _journal_types(), 'type')
        if journal_type:
            domain.append(('type', '=', journal_type))
        return list_page('account.journal', domain, dump_journals)

    @http.route('/api/v1/finance/journals/<int:journal_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_journal(self, journal_id):
        require_capability('finance.journals.read')
        return dump_journal(_find_journal(journal_id))

    @http.route('/api/v1/finance/journals', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_journal(self, **payload):
        require_capability('finance.journals.manage')
        values = _values(parse_journal_create(payload, _journal_types()), request.env.company)
        _require_free_code(values['code'], request.env.company)
        journal = attempt(lambda: request.env['account.journal'].create({**values, 'company_id': request.env.company.id}))
        request.env['webvue.finance.audit.event']._webvue_log('journal_created', journal, fields_written=values)
        return request.make_json_response(dump_journal(journal), status=201)

    @http.route('/api/v1/finance/journals/<int:journal_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_journal(self, journal_id, **payload):
        require_capability('finance.journals.manage')
        journal = _find_journal(journal_id)
        values = _values(parse_journal_patch(payload, _journal_types()), journal.company_id)
        if 'code' in values:
            _require_free_code(values['code'], journal.company_id, journal)
        attempt(lambda: journal.write(values))
        request.env['webvue.finance.audit.event']._webvue_log('journal_changed', journal, fields_written=values)
        return dump_journal(journal)

    @http.route('/api/v1/finance/journals/<int:journal_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_journal(self, journal_id, **_):
        require_capability('finance.journals.manage')
        journal = _find_journal(journal_id)
        attempt(journal.action_archive)
        request.env['webvue.finance.audit.event']._webvue_log('journal_archived', journal)
        return dump_journal(journal)

    @http.route('/api/v1/finance/journals/<int:journal_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_journal(self, journal_id, **_):
        require_capability('finance.journals.manage')
        journal = _find_journal(journal_id)
        attempt(journal.action_unarchive)
        request.env['webvue.finance.audit.event']._webvue_log('journal_unarchived', journal)
        return dump_journal(journal)
