# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.http import request

from .common import parse_choice, require_capability
from .finance_invoices import _find_invoice
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    error_response,
    parse_page,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.zatca import (
    dump_zatca_backlog,
    dump_zatca_journal,
    dump_zatca_readiness,
    dump_zatca_submission,
    dump_zatca_waiting_document,
    waiting_domain,
    zatca_state,
)

ZATCA_OTP = re.compile(r'\d{6}', re.ASCII)
ONBOARD_FIELDS = frozenset({'otp'})
# The documents the work list holds: nothing that ZATCA accepted. Each state is told by the same classification as a submission.
WAITING_STATES = ('pending', 'retry', 'rejected', 'blocked', 'unauthorized')
MAX_WAITING = 500
SUBMISSION_FAILURES = {
    'retry': (502, 'zatca_unavailable', 'ZATCA did not complete the submission; see details.submission and retry later'),
    'rejected': (422, 'zatca_rejected', 'ZATCA rejected the invoice'),
    'blocked': (422, 'zatca_local_error', 'the invoice could not be processed before reaching ZATCA'),
    'unauthorized': (422, 'zatca_unauthorized', 'ZATCA refused the journal certificate; onboard the journal again'),
}


def _parse_otp(payload):
    unknown = sorted(set(payload) - ONBOARD_FIELDS)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])
    otp = payload.get('otp')
    if not isinstance(otp, str) or not ZATCA_OTP.fullmatch(otp):
        raise ApiError(422, 'invalid', 'otp must be the 6-digit one-time password of the Fatoora portal', field='otp')
    return otp


def _submit(invoice_id, *, retry):
    """Submit now; ZATCA saying no or being unreachable is a committed answer carrying the state."""
    move = request.env['liwan.finance.zatca']._liwan_submit(invoice_id, retry)
    submission = dump_zatca_submission(move)
    failure = SUBMISSION_FAILURES.get(submission['state'])
    if failure:
        status, code, message = failure
        return error_response(status, code, message, details={'submission': submission})
    return submission


class FinanceZatcaController(http.Controller):

    @http.route('/api/v1/finance/zatca/status', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_status(self, **_):
        require_capability('finance.zatca.read')
        return {**dump_zatca_readiness(request.env.company), 'backlog': dump_zatca_backlog(request.env.company)}

    @http.route('/api/v1/finance/zatca/journals/<int:journal_id>/onboard', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def onboard_journal(self, journal_id, **payload):
        require_capability('finance.zatca.manage')
        otp = _parse_otp(payload)
        journal = request.env['liwan.finance.zatca']._liwan_onboard(journal_id, otp)
        return dump_zatca_journal(journal)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/zatca', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def get_submission(self, invoice_id, **_):
        require_capability('finance.zatca.read')
        return dump_zatca_submission(_find_invoice(invoice_id))

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/zatca/submit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def submit_invoice(self, invoice_id, **_):
        require_capability('finance.zatca.submit')
        return _submit(invoice_id, retry=False)

    @http.route('/api/v1/finance/invoices/<int:invoice_id>/zatca/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    def retry_invoice(self, invoice_id, **_):
        require_capability('finance.zatca.submit')
        return _submit(invoice_id, retry=True)

    @http.route('/api/v1/finance/zatca/documents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_waiting_documents(self, **_):
        """The work list of e-invoices ZATCA has not accepted (oldest first), filtered by ``state``.

        ``pending`` has not been sent, ``retry`` got no verdict (a retry is safe), ``rejected`` carries ZATCA's validation
        errors, ``blocked`` failed locally before any verdict and ``unauthorized`` means the journal certificate must be
        renewed. At most the oldest 500 waiting documents are examined.
        """
        require_capability('finance.zatca.read')
        state = parse_choice(request.httprequest.args.get('state'), WAITING_STATES, 'state')
        documents = request.env['account.edi.document'].search(waiting_domain(request.env.company), order='id', limit=MAX_WAITING)
        rows = [document for document in documents if (zatca_state(document) == state if state else True)]
        limit, offset = parse_page(request.httprequest.args)
        return {'items': [dump_zatca_waiting_document(document) for document in rows[offset:offset + limit]], 'total': len(rows)}
