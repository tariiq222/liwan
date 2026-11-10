# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""ZATCA e-invoicing (Fatoora phase 2) onboarding and submission, driven through stock ``l10n_sa_edi``.

Stock needs rights no finance group has (``res.company``, ``account.journal`` and ``ir.sequence`` writes,
system-only fields), so the two public entries below are the only elevated places of this module: the
documented R7 case "finance ZATCA e-invoicing". Each one checks the capability, resolves the journal or
invoice inside the current company and refuses any api mode but ``sandbox`` before it elevates, then runs
one stock flow (the OTP wizard, or the EDI processing of that one invoice). No key material, CSR, CSID or
raw ZATCA response leaves this model.
"""
import logging
import re

from odoo import api, fields, models
from odoo.exceptions import MissingError, UserError

from .res_company import (
    SANDBOX_API_MODE,
    SAUDI_COUNTRY_CODE,
    ZATCA_ENVIRONMENT_PERMISSION,
)
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_finance.serializers.zatca import (
    dump_zatca_readiness,
    dump_zatca_submission,
    plain_text,
    retry_allowed_at,
    zatca_document,
)

_logger = logging.getLogger(__name__)

CONNECTION_KIND = 'zatca'
CONNECTION_PROVIDER = 'ZATCA'
MODE_REFUSALS = {
    'preprod': ('zatca_simulation_not_released', 'ZATCA simulation has not been released'),
    'prod': ('zatca_production_not_released', 'ZATCA production has not been released'),
}
ONBOARDING_UNAVAILABLE = 'ZATCA could not be reached; try again later'
ONBOARDING_FAILED = 'ZATCA refused the onboarding'
# What the certificate request needs from the company (stock asks for these and names them in English when one is missing).
CSR_COMPANY_FIELDS = ('vat', 'street', 'city', 'state_id')
# Stock turns every onboarding failure into one text (English: the wizard runs with lang en_US). A "[NNN]"
# marker other than 400 is an HTTP answer stock did not interpret (its text may hold the raw body), and a
# requests exception shows as its own text. Neither the raw response nor the OTP is echoed.
STATUS_MARKER = re.compile(r'\[(\d{3})\]')
TRANSPORT_TEXT = re.compile(r'timed out|timeout|connection|max retries|name or service|temporary failure|ssl', re.IGNORECASE)
BUSY_TEXT = 'being sent by another process'
INVALID_OTP = re.compile(r'invalid[ -]+otp', re.IGNORECASE)
EXPIRED_OTP = re.compile(r'otp[^.]*expired|expired[^.]*otp', re.IGNORECASE)
SALE_MOVE_TYPES = ('out_invoice', 'out_refund')
INVOICE_MOVE_TYPES = (*SALE_MOVE_TYPES, 'in_invoice', 'in_refund')


class LiwanFinanceZatca(models.AbstractModel):
    _name = 'liwan.finance.zatca'
    _description = 'LiwanOS finance ZATCA e-invoicing'

    @api.model
    def _liwan_lock_environment(self, company):
        if not company._liwan_try_lock_zatca():
            raise ApiError(409, 'zatca_environment_busy', 'another ZATCA operation is running for this company')

    @api.model
    def _liwan_require_sandbox(self):
        """Keep the approved elevated flows confined to the developer sandbox."""
        company = self.env.company
        self._liwan_lock_environment(company)
        if company._liwan_zatca_runtime_mode() != SANDBOX_API_MODE:
            raise ApiError(422, 'zatca_mode_not_allowed', 'only the ZATCA sandbox api mode is allowed')

    @api.model
    def _liwan_request_environment(self, mode):
        """Validate the current-company request without allowing an unreleased environment."""
        # Core grants all effective capabilities to support users. Environment decisions belong to the customer.
        if self.env.user.has_group('liwan_core.group_vendor_support'):
            raise ApiError(403, 'forbidden', 'vendor support cannot request a ZATCA environment change')
        self.env['liwan.access.service']._liwan_require_capability(ZATCA_ENVIRONMENT_PERMISSION)
        company = self.env.company
        if (company.account_fiscal_country_id or company.country_id).code != SAUDI_COUNTRY_CODE:
            raise ApiError(422, 'zatca_not_applicable', 'ZATCA applies only to a Saudi company')
        self._liwan_lock_environment(company)
        current = company._liwan_zatca_runtime_mode()
        if current == mode == SANDBOX_API_MODE:
            return {'api_mode': current, 'changed': False}
        code, message = MODE_REFUSALS.get(mode, ('zatca_mode_not_allowed', 'changing the ZATCA environment is unavailable'))
        _logger.warning(
            'finance.zatca.mode_refused company=%s user=%s current=%s target=%s code=%s',
            company.id, self.env.uid, current, mode, code,
        )
        raise ApiError(422, code, message)

    @api.model
    def _liwan_onboarding_failed(self, journal, status, code, message):
        """Log the refused onboarding (nothing durable survives the rollback it raises) and refuse."""
        _logger.warning(
            'finance.zatca.onboard_failed company=%s journal=%s user=%s code=%s',
            self.env.company.id, journal.id, self.env.uid, code,
        )
        raise ApiError(status, code, message)

    @api.model
    def _liwan_find(self, model, record_id, domain):
        record = self.env[model].search(
            [('id', '=', record_id), ('company_id', '=', self.env.company.id), *domain], limit=1,
        )
        if not record:
            raise MissingError(self.env._('%(model)s %(id)s does not exist', model=model, id=record_id))
        return record

    @api.model
    def _liwan_require_company_profile(self, company):
        """The certificate request names the company: its tax number and address must be set before ZATCA is asked."""
        missing = [field for field in CSR_COMPANY_FIELDS if not company[field]]
        if missing:
            raise ApiError(
                422, 'company_profile_incomplete', 'set the tax number and the address of the company first',
                field=missing[0], details={'missing': missing},
            )

    @api.model
    def _liwan_onboard(self, journal_id, otp):
        """Onboard one sales journal of the current company with the OTP (sandbox only).

        Runs the stock wizard: compliance CSID, compliance checks, production CSID. Stock stores a
        failure on the journal instead of raising, so the outcome is read back; a failure raises, which
        rolls the whole request back and keeps a previously working onboarding intact.
        """
        self.env['liwan.access.service']._liwan_require_capability('finance.zatca.manage')
        journal = self._liwan_find('account.journal', journal_id, [('type', '=', 'sale')])
        self._liwan_require_sandbox()
        self._liwan_require_company_profile(journal.company_id)
        elevated = self.sudo().with_context(lang='en_US')
        # Stock validate uses the wizard fields and journal, so an in-memory transient keeps the OTP out of the database.
        elevated.env['l10n_sa_edi.otp.wizard'].new({'journal_id': journal.id, 'l10n_sa_otp': otp}).validate()
        if not journal._l10n_sa_ready_to_submit_einvoices():
            text = plain_text(elevated.env['account.journal'].browse(journal.id).l10n_sa_csr_errors)
            marker = STATUS_MARKER.search(text)
            if (marker and marker.group(1) != '400') or TRANSPORT_TEXT.search(text):
                self._liwan_onboarding_failed(journal, 502, 'zatca_unavailable', ONBOARDING_UNAVAILABLE)
            message = ONBOARDING_FAILED
            if EXPIRED_OTP.search(text):
                message = 'The ZATCA one-time password has expired'
            elif INVALID_OTP.search(text):
                message = 'Invalid OTP'
            self._liwan_onboarding_failed(journal, 422, 'zatca_rejected', message)
        readiness = dump_zatca_readiness(self.env.company)
        done = sum(row['onboarded'] for row in readiness['journals'])
        elevated.env['liwan.integration.connection']._liwan_set_connection_state(
            self.env.company, CONNECTION_KIND, CONNECTION_PROVIDER,
            'connected' if readiness['onboarded'] else 'pending',
            f'ZATCA sandbox: {done} of {len(readiness["journals"])} sales journals onboarded',
        )
        _logger.info('finance.zatca.onboarded company=%s journal=%s user=%s', self.env.company.id, journal.id, self.env.uid)
        self.env['liwan.finance.audit.event']._liwan_log('zatca_onboarded', journal)
        return journal

    @api.model
    def _liwan_submit(self, move_id, retry):
        """Send one posted Saudi sale document of the current company to ZATCA now (sandbox only).

        ``retry`` first clears the stock error of a rejected or failed document. A document that was already sent by
        hand once is spaced and counted as a retry on either route (the first manual send is never throttled). Stock persists the
        outcome on the document (it keeps the chain index only when ZATCA may have received the document,
        and resets it on a definite answer), so the caller reads the state back and the request must
        commit even when ZATCA said no.
        """
        self.env['liwan.access.service']._liwan_require_capability('finance.zatca.submit')
        move = self._liwan_find('account.move', move_id, [('move_type', 'in', INVOICE_MOVE_TYPES)])
        if move.move_type not in SALE_MOVE_TYPES:
            raise ApiError(422, 'zatca_not_applicable', 'the document is not a ZATCA sale document')
        self._liwan_require_sandbox()
        document = zatca_document(move)
        if move.state != 'posted' or not document:
            raise ApiError(422, 'zatca_not_applicable', 'the document is not a posted ZATCA e-invoice')
        if not move.journal_id._l10n_sa_ready_to_submit_einvoices():
            raise ApiError(422, 'zatca_not_onboarded', 'the sales journal is not ZATCA-onboarded')
        if document.state != 'to_send':
            raise ApiError(422, 'invalid_state', 'the document was already accepted by ZATCA')
        if not retry and document.blocking_level == 'error':
            raise ApiError(422, 'invalid_state', 'ZATCA rejected the document; correct it and retry')
        # Whichever route sends it, a document already sent by hand once is a retry: spaced and counted.
        repeat = retry or bool(document.liwan_zatca_last_attempt_at)
        if repeat:
            allowed_at = retry_allowed_at(document)
            if allowed_at and fields.Datetime.now() < allowed_at:
                raise ApiError(
                    422, 'retry_too_soon', 'the document was sent too recently; retry after next_retry_at',
                    details={'next_retry_at': iso(allowed_at), 'retry_count': document.liwan_zatca_retry_count},
                )
        elevated_move = self.sudo().with_context(lang='en_US').env['account.move'].browse(move.id)
        self._liwan_record_attempt(zatca_document(elevated_move), repeat)
        if retry:
            self._liwan_retry_zatca_document(elevated_move)
        try:
            # The move-level action is the public wrapper; the document-level processor is private in stock.
            elevated_move.action_process_edi_web_services(with_commit=False)
        except UserError as error:
            if BUSY_TEXT in str(error):
                raise ApiError(422, 'invalid_state', 'the document is being sent by another process; try again shortly') from None
            raise
        state = dump_zatca_submission(move)['state']
        log = _logger.info if state == 'accepted' else _logger.warning
        log(
            'finance.zatca.submitted company=%s move=%s user=%s retry=%s state=%s',
            self.env.company.id, move.id, self.env.uid, retry, state,
        )
        self.env['liwan.finance.audit.event']._liwan_log('zatca_submitted', move, outcome=state)
        return move

    @api.model
    def _liwan_record_attempt(self, document, repeat):
        """Stamp a manual send on the document and count it when it repeats an earlier one; a send that raises rolls this back with it."""
        values = {'liwan_zatca_last_attempt_at': fields.Datetime.now()}
        if repeat:
            values['liwan_zatca_retry_count'] = document.liwan_zatca_retry_count + 1
        document.write(values)

    def _liwan_retry_zatca_document(self, move):
        """Clear the stored failure of the ZATCA document of ``move``, leaving every other EDI format of the move untouched.

        Stock's ``_retry_edi_documents_error`` writes ``error`` and ``blocking_level`` on **every** EDI document of the move
        (``account_edi/models/account_move.py:367``), so a failure of another format would vanish from the work list and its
        cron would retry it with nobody told why it had failed. The two lines of stock's ``l10n_sa_edi`` override
        (``l10n_sa_edi/models/account_move.py:338``: clear the chain head so a blocked chain can be sent again, and detach
        the attachments so the XML is regenerated) are therefore reproduced here instead of calling it: going through the
        hook would also reach that all-formats write, which is exactly what this method exists to avoid.
        """
        documents = zatca_document(move)
        move.filtered(lambda invoice: invoice.country_code == 'SA').write({'l10n_sa_edi_chain_head_id': False})
        move._detach_attachments()
        documents.write({'error': False, 'blocking_level': False})
