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

from odoo import api, models
from odoo.exceptions import MissingError, UserError

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_finance.serializers.zatca import (
    dump_zatca_readiness,
    dump_zatca_submission,
    plain_text,
    zatca_document,
)

_logger = logging.getLogger(__name__)

CONNECTION_KIND = 'zatca'
CONNECTION_PROVIDER = 'ZATCA'
SANDBOX = 'sandbox'
ONBOARDING_UNAVAILABLE = 'ZATCA could not be reached; try again later'
ONBOARDING_FAILED = 'ZATCA refused the onboarding'
# Stock turns every onboarding failure into one text (English: the wizard runs with lang en_US). A "[NNN]"
# marker other than 400 is an HTTP answer stock did not interpret (its text may hold the raw body), and a
# requests exception shows as its own text; both are "ZATCA unavailable". Only the 400 answer, which carries
# no marker, and stock's own short messages are echoed.
STATUS_MARKER = re.compile(r'\[(\d{3})\]')
TRANSPORT_TEXT = re.compile(r'timed out|timeout|connection|max retries|name or service|temporary failure|ssl', re.IGNORECASE)
BUSY_TEXT = 'being sent by another process'
SALE_MOVE_TYPES = ('out_invoice', 'out_refund')


class WebVueFinanceZatca(models.AbstractModel):
    _name = 'webvue.finance.zatca'
    _description = 'WebVue finance ZATCA e-invoicing'

    @api.model
    def _webvue_require_sandbox(self):
        """Live ZATCA calls are limited to the sandbox until the preprod and production policy exists."""
        if self.env.company.l10n_sa_api_mode != SANDBOX:
            raise ApiError(422, 'zatca_mode_not_allowed', 'only the ZATCA sandbox api mode is allowed')

    @api.model
    def _webvue_onboarding_failed(self, journal, status, code, message):
        """Log the refused onboarding (nothing durable survives the rollback it raises) and refuse."""
        _logger.warning(
            'finance.zatca.onboard_failed company=%s journal=%s user=%s code=%s',
            self.env.company.id, journal.id, self.env.uid, code,
        )
        raise ApiError(status, code, message)

    @api.model
    def _webvue_find(self, model, record_id, domain):
        record = self.env[model].search(
            [('id', '=', record_id), ('company_id', '=', self.env.company.id), *domain], limit=1,
        )
        if not record:
            raise MissingError(self.env._('%(model)s %(id)s does not exist', model=model, id=record_id))
        return record

    @api.model
    def _webvue_onboard(self, journal_id, otp):
        """Onboard one sales journal of the current company with the OTP (sandbox only).

        Runs the stock wizard: compliance CSID, compliance checks, production CSID. Stock stores a
        failure on the journal instead of raising, so the outcome is read back; a failure raises, which
        rolls the whole request back and keeps a previously working onboarding intact.
        """
        self.env['webvue.access.service']._webvue_require_capability('finance.zatca.manage')
        journal = self._webvue_find('account.journal', journal_id, [('type', '=', 'sale')])
        self._webvue_require_sandbox()
        elevated = self.sudo().with_context(lang='en_US')
        elevated.env['l10n_sa_edi.otp.wizard'].create({'journal_id': journal.id, 'l10n_sa_otp': otp}).validate()
        if not journal._l10n_sa_ready_to_submit_einvoices():
            text = plain_text(elevated.env['account.journal'].browse(journal.id).l10n_sa_csr_errors)
            marker = STATUS_MARKER.search(text)
            if (marker and marker.group(1) != '400') or TRANSPORT_TEXT.search(text):
                self._webvue_onboarding_failed(journal, 502, 'zatca_unavailable', ONBOARDING_UNAVAILABLE)
            self._webvue_onboarding_failed(journal, 422, 'zatca_rejected', text or ONBOARDING_FAILED)
        readiness = dump_zatca_readiness(self.env.company)
        done = sum(row['onboarded'] for row in readiness['journals'])
        elevated.env['webvue.integration.connection']._webvue_set_connection_state(
            self.env.company, CONNECTION_KIND, CONNECTION_PROVIDER,
            'connected' if readiness['onboarded'] else 'pending',
            f'ZATCA sandbox: {done} of {len(readiness["journals"])} sales journals onboarded',
        )
        _logger.info('finance.zatca.onboarded company=%s journal=%s user=%s', self.env.company.id, journal.id, self.env.uid)
        self.env['webvue.finance.audit.event']._webvue_log('zatca_onboarded', journal)
        return journal

    @api.model
    def _webvue_submit(self, move_id, retry):
        """Send one posted Saudi sale document of the current company to ZATCA now (sandbox only).

        ``retry`` first clears the stock error of a rejected or failed document. Stock persists the
        outcome on the document (it keeps the chain index only when ZATCA may have received the document,
        and resets it on a definite answer), so the caller reads the state back and the request must
        commit even when ZATCA said no.
        """
        self.env['webvue.access.service']._webvue_require_capability('finance.zatca.submit')
        move = self._webvue_find('account.move', move_id, [('move_type', 'in', SALE_MOVE_TYPES)])
        self._webvue_require_sandbox()
        document = zatca_document(move)
        if move.state != 'posted' or not document:
            raise ApiError(422, 'zatca_not_applicable', 'the document is not a posted ZATCA e-invoice')
        if not move.journal_id._l10n_sa_ready_to_submit_einvoices():
            raise ApiError(422, 'zatca_not_onboarded', 'the sales journal is not ZATCA-onboarded')
        if document.state != 'to_send':
            raise ApiError(422, 'invalid_state', 'the document was already accepted by ZATCA')
        if not retry and document.blocking_level == 'error':
            raise ApiError(422, 'invalid_state', 'ZATCA rejected the document; correct it and retry')
        elevated_move = self.sudo().with_context(lang='en_US').env['account.move'].browse(move.id)
        if retry:
            elevated_move._retry_edi_documents_error()
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
        self.env['webvue.finance.audit.event']._webvue_log('zatca_submitted', move, outcome=state)
        return move
