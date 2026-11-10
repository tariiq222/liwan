# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from contextvars import Context
from unittest.mock import patch

from odoo import SUPERUSER_ID, api, sql_db
from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from .write_common import PASSWORD, LiwanFinanceWriteCase
from odoo.addons.liwan_finance.models.zatca_runtime import (
    STOCK_JOURNAL_LOGGER,
    _omit_csid_log_payload,
)

MODE_URL = '/api/v1/finance/zatca/mode'


@tagged('post_install', '-at_install', 'liwan')
class TestZatcaEnvironment(LiwanFinanceWriteCase):

    def test_mode_permission_is_independent_and_release_gate_refuses_both_modes(self):
        self.assertRefused(self.api('POST', MODE_URL, json={
            'mode': 'preprod', 'confirmation': 'SIMULATION',
        }), 403, 'forbidden')
        actor = self.user_with('finance_zatca_environment_only', ['finance.invoices.read', 'finance.zatca.read', 'finance.zatca.environment'])
        self.authenticate(actor.login, PASSWORD)
        self.assertRefused(self.api('POST', MODE_URL, json={
            'mode': 'preprod', 'confirmation': 'simulation',
        }), 422, 'invalid', 'confirmation')
        for mode, confirmation, code in (
            ('preprod', 'SIMULATION', 'zatca_simulation_not_released'),
            ('prod', 'PRODUCTION', 'zatca_production_not_released'),
        ):
            self.assertRefused(self.api('POST', MODE_URL, json={
                'mode': mode, 'confirmation': confirmation,
            }), 422, code)
        self.assertRefused(self.api('POST', MODE_URL, json={
            'mode': 'preprod', 'confirmation': 'SIMULATION', 'company_id': self.other_company.id,
        }), 404, 'not_found')
        replay = self.api('POST', MODE_URL, json={'mode': 'sandbox', 'confirmation': 'SANDBOX'})
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), {'api_mode': 'sandbox', 'changed': False})
        self.assertEqual(self.company.l10n_sa_api_mode, 'sandbox')
        self.assertEqual(self.other_company.l10n_sa_api_mode, 'sandbox')

    def test_stock_company_noop_keeps_journal_credentials_and_disallows_other_modes(self):
        journal = self._journal(self.company, 'sale')
        with patch.object(type(journal), '_l10n_sa_reset_certificates', autospec=True) as reset:
            self.company.write({'l10n_sa_api_mode': 'sandbox'})
            reset.assert_not_called()
        for mode in ('preprod', 'prod'):
            with self.subTest(mode=mode), self.assertRaises(ValidationError), self.env.cr.savepoint():
                self.company.sudo().write({'l10n_sa_api_mode': mode})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.env['res.company'].with_context(default_l10n_sa_api_mode='prod').create({'name': 'Refused'})

    def test_native_sandbox_post_callback_delegates_and_other_operations_are_preserved(self):
        move = self.env['account.move'].browse(self.create_invoice()['id'])
        edi = self.env.ref('l10n_sa_edi.edi_sa_zatca')
        with patch.object(type(edi), '_l10n_sa_post_zatca_edi', autospec=True) as post:
            post.return_value = {move: {'success': True}}
            callbacks = edi._get_move_applicability(move)
            self.assertEqual(callbacks['edi_content'], edi._l10n_sa_get_invoice_content_edi)
            self.assertEqual(callbacks['post'](move), {move: {'success': True}})
            post.assert_called_once_with(edi, move)
        purchase = self.env['account.move'].browse(self.create_invoice(self.bill_body())['id'])
        self.assertFalse(edi._get_move_applicability(purchase))

    def test_native_callback_and_wizard_refuse_legacy_unsupported_mode(self):
        move = self.env['account.move'].browse(self.create_invoice()['id'])
        journal = move.journal_id
        edi = self.env.ref('l10n_sa_edi.edi_sa_zatca')
        wizard = self.env['l10n_sa_edi.otp.wizard'].create({'journal_id': journal.id, 'l10n_sa_otp': '123345'})
        for mode in ('preprod', 'prod'):
            with self.subTest(mode=mode), patch.object(type(move.company_id), '_liwan_zatca_runtime_mode',
                                                        create=True, return_value=mode):
                with patch.object(type(edi), '_l10n_sa_post_zatca_edi', autospec=True) as post:
                    result = edi._get_move_applicability(move)['post'](move)[move]
                    self.assertEqual(result['blocking_level'], 'error')
                    post.assert_not_called()
                with patch.object(type(journal), '_l10n_sa_api_onboard_journal', autospec=True) as onboard:
                    with self.assertRaises(UserError):
                        wizard.validate()
                    onboard.assert_not_called()

    def test_locked_company_prevents_native_post_callback(self):
        move = self.env['account.move'].browse(self.create_invoice()['id'])
        edi = self.env.ref('l10n_sa_edi.edi_sa_zatca')
        with patch.object(type(move.company_id), 'try_lock_for_update', return_value=self.env['res.company']):
            with patch.object(type(edi), '_l10n_sa_post_zatca_edi', autospec=True) as post:
                result = edi._get_move_applicability(move)['post'](move)[move]
                self.assertEqual(result['blocking_level'], 'warning')
                post.assert_not_called()

    def test_another_transaction_holding_a_company_fence_is_skipped(self):
        # Use a committed stock row so the independent cursor does not share fixture savepoints.
        company = self.env.ref('base.main_company')
        with sql_db.db_connect(self.env.cr.dbname).cursor() as cursor:
            other = api.Environment(cursor, SUPERUSER_ID, {})['res.company'].browse(company.id)
            other.lock_for_update(allow_referencing=True)
            self.assertFalse(company._liwan_try_lock_zatca())

    def test_stock_payload_filter_is_context_local_and_resets_after_exception(self):
        logger = logging.getLogger(STOCK_JOURNAL_LOGGER)

        def _l10n_sa_get_csid_error(payload):
            logger.warning('Failed to obtain CSID: %s', payload)

        with self.assertLogs(STOCK_JOURNAL_LOGGER, 'WARNING') as logs:
            with self.assertRaises(RuntimeError), _omit_csid_log_payload():
                _l10n_sa_get_csid_error('sensitive fixture')
                Context().run(_l10n_sa_get_csid_error, 'different context')
                logger.warning('unrelated stock diagnostic')
                raise RuntimeError
            _l10n_sa_get_csid_error('outside scope')
        messages = [record.getMessage() for record in logs.records]
        self.assertEqual(messages, [
            'Failed to obtain ZATCA CSID (response details withheld)',
            'Failed to obtain CSID: different context',
            'unrelated stock diagnostic',
            'Failed to obtain CSID: outside scope',
        ])

    def test_hourly_edi_fallback_preserves_the_stock_callback(self):
        cron = self.env.ref('account_edi.ir_cron_edi_network')
        self.assertEqual((cron.interval_number, cron.interval_type), (1, 'hours'))
        self.assertEqual(cron.code, 'model._cron_process_documents_web_services(job_count=20)')
