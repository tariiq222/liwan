# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from contextlib import contextmanager
from contextvars import ContextVar

from odoo import models
from odoo.exceptions import UserError

from .res_company import SANDBOX_API_MODE
from odoo.addons.liwan_finance.serializers.zatca import ZATCA_FORMAT_CODE

STOCK_JOURNAL_LOGGER = 'odoo.addons.l10n_sa_edi.models.account_journal'
_REDACT_GATEWAY_PAYLOAD = ContextVar('liwan_finance.zatca.redact_gateway_payload', default=False)
_COMPLIANCE_LOG_FORMATS = {
    'ZATCA_ERROR: Compliance API returned an error for journal=%s (id=%s, company_id=%s, file=%s, error=%s)':
        'ZATCA_ERROR: Compliance API returned an error for journal=%s (id=%s, company_id=%s, file=%s)',
    ('ZATCA_ERROR: Compliance validation failed for journal=%s '
     '(id=%s, company_id=%s, file=%s, status=%s, error_messages=%s)'):
        'ZATCA_ERROR: Compliance validation failed for journal=%s (id=%s, company_id=%s, file=%s)',
}


class _GatewayPayloadFilter(logging.Filter):
    def filter(self, record):
        if not _REDACT_GATEWAY_PAYLOAD.get():
            return True
        # Stock logs these gateway-supplied values during onboarding. Keep local diagnostics,
        # never the echoed credentials or untrusted validation status and messages.
        if record.funcName == '_l10n_sa_get_csid_error' and record.msg == 'Failed to obtain CSID: %s':
            record.msg = 'Failed to obtain ZATCA CSID (response details withheld)'
            record.args = ()
        elif record.funcName == '_l10n_sa_run_compliance_checks' and record.msg in _COMPLIANCE_LOG_FORMATS:
            record.msg = _COMPLIANCE_LOG_FORMATS[record.msg]
            record.args = record.args[:4]
        return True


logging.getLogger(STOCK_JOURNAL_LOGGER).addFilter(_GatewayPayloadFilter())


@contextmanager
def _omit_gateway_log_payloads():
    token = _REDACT_GATEWAY_PAYLOAD.set(True)
    try:
        yield
    finally:
        _REDACT_GATEWAY_PAYLOAD.reset(token)


class AccountEdiFormat(models.Model):
    _inherit = 'account.edi.format'

    def _get_move_applicability(self, move):
        # Odoo's EDI format extension point (account_edi/models/account_edi_format.py:55).
        # Wrap only Saudi posting. The stock cron and immediate processing use this callback.
        callbacks = super()._get_move_applicability(move)
        if self.code != ZATCA_FORMAT_CODE or not callbacks or not callbacks.get('post'):
            return callbacks
        post = callbacks['post']

        def guarded_post(invoice):
            company = invoice.company_id
            if invoice.journal_id.company_id != company:
                return {invoice: {'error': self.env._('The ZATCA journal belongs to a different company.'), 'blocking_level': 'error'}}
            if not company._liwan_try_lock_zatca():
                return {invoice: {'error': self.env._('Another ZATCA operation is running for this company.'), 'blocking_level': 'warning'}}
            if company._liwan_zatca_runtime_mode() != SANDBOX_API_MODE:
                return {invoice: {'error': self.env._('This ZATCA environment has not been released.'), 'blocking_level': 'error'}}
            with _omit_gateway_log_payloads():
                return post(invoice)

        return {**callbacks, 'post': guarded_post}


class ZatcaOtpWizard(models.TransientModel):
    _inherit = 'l10n_sa_edi.otp.wizard'

    def validate(self):
        self.ensure_one()
        company = self.journal_id.company_id
        if company != self.env.company:
            raise UserError(self.env._('The ZATCA journal belongs to a different company.'))
        if not company._liwan_try_lock_zatca():
            raise UserError(self.env._('Another ZATCA operation is running for this company.'))
        if company._liwan_zatca_runtime_mode() != SANDBOX_API_MODE:
            raise UserError(self.env._('This ZATCA environment has not been released.'))
        with _omit_gateway_log_payloads():
            return super().validate()
