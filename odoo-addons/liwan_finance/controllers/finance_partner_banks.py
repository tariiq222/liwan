# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .common import require_capability
from .finance_partners import find_partner
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.parsing import require_nonempty
from odoo.addons.liwan_finance.serializers.partner_bank import (
    dump_partner_bank,
    dump_partner_banks,
    parse_partner_bank_create,
    parse_partner_bank_patch,
    sanitize_account,
)


def _find_bank_account(partner, bank_account_id):
    bank_account = request.env['res.partner.bank'].with_context(active_test=False).search(
        [('id', '=', bank_account_id), ('partner_id', '=', partner.id)], limit=1,
    )
    if not bank_account:
        raise MissingError(request.env._('res.partner.bank %(id)s does not exist', id=bank_account_id))
    return bank_account


def _bank_of(parsed, current=None):
    """The ``res.bank`` named by the body: found by BIC, else by name, else created."""
    name = parsed.get('bank_name', current.bank_id.name if current else '')
    bic = parsed.get('bic', current.bank_id.bic if current else '')
    if not name:
        return False
    Bank = request.env['res.bank']
    domain = [('bic', '=', bic)] if bic else [('name', '=', name)]
    return Bank.search(domain, limit=1) or Bank.create({'name': name, 'bic': bic or False})


def _values(parsed, current=None):
    values = {}
    if 'acc_number' in parsed:
        values['acc_number'] = parsed['acc_number']
    if 'holder_name' in parsed:
        values['acc_holder_name'] = parsed['holder_name'] or False
    if {'bank_name', 'bic'} & parsed.keys():
        values['bank_id'] = _bank_of(parsed, current).id
    return values


def _reject_duplicate(partner, account, exclude=None):
    domain = [('partner_id', '=', partner.id), ('sanitized_acc_number', '=', sanitize_account(account))]
    if exclude:
        domain.append(('id', '!=', exclude.id))
    if request.env['res.partner.bank'].with_context(active_test=False).search_count(domain):
        raise ApiError(422, 'duplicate', 'the partner already has this bank account', field='acc_number')


class FinancePartnerBankController(http.Controller):
    """Bank accounts of a customer or vendor: where its payments go. Only archiving removes one."""

    @http.route('/api/v1/finance/partners/<int:partner_id>/bank-accounts', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_bank_accounts(self, partner_id):
        require_capability('finance.partners.read')
        partner = find_partner(partner_id)
        accounts = request.env['res.partner.bank'].with_context(active_test=False).search(
            [('partner_id', '=', partner.id)], order='active desc, id',
        )
        return {'items': dump_partner_banks(accounts), 'total': len(accounts)}

    @http.route('/api/v1/finance/partners/<int:partner_id>/bank-accounts', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def create_bank_account(self, partner_id, **payload):
        require_capability('finance.partners.manage')
        partner = find_partner(partner_id)
        parsed = parse_partner_bank_create(payload)
        _reject_duplicate(partner, parsed['acc_number'])
        values = _values(parsed)
        account = request.env['res.partner.bank'].create({**values, 'partner_id': partner.id})
        request.env['liwan.finance.audit.event']._liwan_log('partner_bank_added', account, fields_written=values)
        return request.make_json_response(dump_partner_bank(account), status=201)

    @http.route('/api/v1/finance/partners/<int:partner_id>/bank-accounts/<int:bank_account_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def patch_bank_account(self, partner_id, bank_account_id, **payload):
        require_capability('finance.partners.manage')
        partner = find_partner(partner_id)
        account = _find_bank_account(partner, bank_account_id)
        require_nonempty(payload)
        parsed = parse_partner_bank_patch(payload)
        if 'acc_number' in parsed:
            _reject_duplicate(partner, parsed['acc_number'], exclude=account)
        values = _values(parsed, account)
        account.write(values)
        request.env['liwan.finance.audit.event']._liwan_log('partner_bank_changed', account, fields_written=values)
        return dump_partner_bank(account)

    @http.route('/api/v1/finance/partners/<int:partner_id>/bank-accounts/<int:bank_account_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def archive_bank_account(self, partner_id, bank_account_id, **_):
        require_capability('finance.partners.manage')
        account = _find_bank_account(find_partner(partner_id), bank_account_id)
        account.action_archive()
        request.env['liwan.finance.audit.event']._liwan_log('partner_bank_archived', account)
        return dump_partner_bank(account)

    @http.route('/api/v1/finance/partners/<int:partner_id>/bank-accounts/<int:bank_account_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def unarchive_bank_account(self, partner_id, bank_account_id, **_):
        require_capability('finance.partners.manage')
        account = _find_bank_account(find_partner(partner_id), bank_account_id)
        account.action_unarchive()
        request.env['liwan.finance.audit.event']._liwan_log('partner_bank_unarchived', account)
        return dump_partner_bank(account)
