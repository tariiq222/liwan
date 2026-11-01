# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from unittest.mock import patch

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .test_finance_zatca import secret_keys
from .zatca_common import (
    ERROR,
    SANDBOX_OTP,
    WARNING,
    FakeZatca,
    LiwanZatcaCase,
    answer,
    reply,
    results,
    unreachable,
)
from odoo.addons.liwan_api.tests.common import set_probe_feature

STATUS = '/api/v1/finance/zatca/status'
SUBMISSION_KEYS = {'state', 'mode', 'errors', 'warnings', 'qr_present'}
JOURNAL_KEYS = {'journal', 'onboarded', 'state'}
ONBOARDING_ENDPOINTS = ['compliance'] + ['compliance/invoices'] * 6 + ['production/csids']


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaOnboarding(LiwanZatcaCase):

    def _status(self):
        result = self.api('GET', STATUS)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _connection(self):
        return self.env['liwan.integration.connection'].search([
            ('company_id', '=', self.company.id), ('kind', '=', 'zatca'),
        ])

    def test_onboarding_runs_the_stock_three_steps_against_the_sandbox_only(self):
        result = self.onboard()
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), JOURNAL_KEYS)
        self.assertEqual((body['journal']['id'], body['onboarded'], body['state']), (self.sale_journal.id, True, 'onboarded'))
        self.assertEqual(self.zatca.endpoints(), ONBOARDING_ENDPOINTS)
        self.assertNoSecrets(result)
        status = self._status()
        self.assertEqual((status['api_mode'], status['private_key_present'], status['onboarded']), ('sandbox', True, True))
        self.assertNoSecrets(self.api('GET', STATUS))

    def test_the_stock_edi_cron_is_active_and_runs_daily_with_an_immediate_trigger_per_submission(self):
        cron = self.env.ref('account_edi.ir_cron_edi_network')
        self.assertTrue(cron.active)
        self.assertEqual((cron.interval_number, cron.interval_type), (1, 'days'))

    def test_the_status_reports_the_backlog_of_the_current_company_only(self):
        self.onboarded_journal()
        self.assertEqual(self._status()['backlog'], {'to_send': 0, 'retry': 0, 'rejected': 0, 'blocked': 0})
        retry, rejected, blocked, _pending = (self.sale_invoice() for _index in range(4))
        # What stock stores: a warning without a verdict, an error with ZATCA's coded line, an error without one.
        for invoice, level, error in (
            (retry, 'warning', 'ZATCA could not be reached'),
            (rejected, 'error', '<p>BR-KSA-F-06-C01 : The invoice type code is not valid</p>'),
            (blocked, 'error', 'signing failed'),
        ):
            self.env['account.move'].browse(invoice['id']).edi_document_ids.write({'blocking_level': level, 'error': error})
        # A waiting document of another company is not counted.
        self.env['account.edi.document'].create({
            'move_id': self.other_invoice.id, 'edi_format_id': self.env.ref('l10n_sa_edi.edi_sa_zatca').id, 'state': 'to_send',
        })
        status = self._status()
        self.assertEqual(status['backlog'], {'to_send': 1, 'retry': 1, 'rejected': 1, 'blocked': 1})
        self.assertEqual(secret_keys(status), set())

    def test_the_status_backlog_needs_the_zatca_read_capability(self):
        self.login_as('zatca_reader')
        self.assertIn('backlog', self.api('GET', STATUS).json())
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', STATUS), 403, 'forbidden')

    def test_a_successful_onboarding_leaves_a_log_record_and_an_audit_event(self):
        with self.assertLogs('odoo.addons.liwan_finance.models.zatca_service', 'INFO') as logs:
            self.onboarded_journal()
        self.assertEqual(
            [record.getMessage() for record in logs.records],
            [f'finance.zatca.onboarded company={self.company.id} journal={self.sale_journal.id} user={self.manager.id}'],
        )
        event = self.env['liwan.finance.audit.event'].search([('action', '=', 'zatca_onboarded')])
        self.assertEqual((event.company_id, event.res_model, event.res_id, event.create_uid), (self.company, 'account.journal', self.sale_journal.id, self.manager))
        self.assertNotIn(SANDBOX_OTP, ' '.join(logs.output) + str(event.read()))

    def test_a_refused_onboarding_logs_a_warning_without_the_otp(self):
        self.zatca.answers['compliance'] = answer(400, {'message': 'Invalid OTP'})
        with self.assertLogs('odoo.addons.liwan_finance.models.zatca_service', 'WARNING') as logs:
            result = self.onboard()
        self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(
            [record.getMessage() for record in logs.records],
            [f'finance.zatca.onboard_failed company={self.company.id} journal={self.sale_journal.id} user={self.manager.id} code=zatca_rejected'],
        )
        self.assertNotIn(SANDBOX_OTP, ' '.join(logs.output))

    def test_onboarding_updates_the_integrations_connection(self):
        self.assertEqual(self._connection().state, 'not_configured')
        self.onboard()
        connection = self._connection()
        self.assertEqual(connection.state, 'connected')
        self.assertEqual(connection.status_message, 'ZATCA sandbox: 1 of 1 sales journals onboarded')
        self.assertTrue(connection.last_checked)

    def test_one_journal_of_two_leaves_the_connection_pending(self):
        self.env['account.journal'].create({
            'name': 'Second sales', 'code': 'SAL2', 'type': 'sale', 'company_id': self.company.id,
        })
        self.onboard()
        connection = self._connection()
        self.assertEqual((connection.state, connection.status_message), ('pending', 'ZATCA sandbox: 1 of 2 sales journals onboarded'))

    def test_a_company_without_its_address_is_refused_before_zatca_is_asked(self):
        self.company.write({'street': False, 'city': False})
        result = self.onboard()
        self.assertRefused(result, 422, 'company_profile_incomplete')
        self.assertEqual(result.json()['details']['missing'], ['street', 'city'])
        self.assertNotIn('Please set', result.json()['message'])
        self.assertEqual(self.zatca.endpoints(), [])
        self.assertFalse(self.sale_journal._l10n_sa_ready_to_submit_einvoices())

    def test_a_rejected_otp_is_422_zatca_rejected_and_changes_nothing(self):
        self.zatca.answers['compliance'] = answer(400, {'errors': [{'code': 'Invalid-OTP', 'message': 'Invalid OTP'}]})
        result = self.onboard()
        self.assertRefused(result, 422, 'zatca_rejected')
        self.assertIn('Invalid OTP', result.json()['message'])
        self.assertNoSecrets(result)
        self.assertFalse(self.sale_journal._l10n_sa_ready_to_submit_einvoices())
        self.assertEqual(self._connection().state, 'not_configured')

    def test_zatca_down_is_502_zatca_unavailable(self):
        for name, handler in (
            ('503', lambda _body: reply(503, None, text='Service Unavailable')),
            ('no connection', unreachable),
        ):
            with self.subTest(name):
                self.zatca.answers['compliance'] = handler
                result = self.onboard()
                self.assertRefused(result, 502, 'zatca_unavailable')
                self.assertNotIn('Service Unavailable', result.text)
                self.assertFalse(self.sale_journal._l10n_sa_ready_to_submit_einvoices())

    def test_an_unexpected_http_status_is_502_without_echoing_the_body_in_any_language(self):
        self.manager.lang = 'ar_001'
        self.zatca.answers['compliance'] = lambda _body: reply(401, None, text='RAW-ZATCA-401-BODY')
        result = self.onboard()
        self.assertRefused(result, 502, 'zatca_unavailable')
        self.assertNotIn('RAW-ZATCA-401-BODY', result.text)
        self.assertFalse(self.sale_journal._l10n_sa_ready_to_submit_einvoices())

    def test_a_failed_compliance_check_is_422_zatca_rejected(self):
        self.zatca.answers['compliance/invoices'] = answer(200, {'validationResults': results('ERROR', errors=[ERROR])})
        result = self.onboard()
        self.assertRefused(result, 422, 'zatca_rejected')
        self.assertFalse(self.sale_journal._l10n_sa_ready_to_submit_einvoices())

    def test_a_failed_re_onboarding_keeps_the_working_onboarding(self):
        self.onboarded_journal()
        self.zatca.answers['compliance'] = answer(400, {'errors': [{'code': 'Invalid-OTP', 'message': 'Invalid OTP'}]})
        self.assertRefused(self.onboard(), 422, 'zatca_rejected')
        self.assertTrue(self.sale_journal._l10n_sa_ready_to_submit_einvoices())
        self.assertEqual(self._connection().state, 'connected')
        self.zatca.answers.clear()
        self.assertEqual(self.onboard().status_code, 200)

    def test_the_otp_is_validated_before_any_network_call(self):
        url = f'/api/v1/finance/zatca/journals/{self.sale_journal.id}/onboard'
        for body, field in (({}, 'otp'), ({'otp': '12'}, 'otp'), ({'otp': 123345}, 'otp'), ({'otp': '123345', 'mode': 'prod'}, 'mode')):
            with self.subTest(body=body), self.zatca.patched():
                self.assertRefused(self.api('POST', url, json=body), 422, 'invalid', field=field)
        self.assertEqual(self.zatca.calls, [])

    def test_only_the_sandbox_api_mode_is_allowed(self):
        for mode in ('preprod', 'prod'):
            with self.subTest(mode):
                self.force_api_mode(mode)
                self.assertRefused(self.onboard(), 422, 'zatca_mode_not_allowed')
        self.assertEqual(self.zatca.calls, [])

    def test_a_journal_of_another_company_or_type_is_404(self):
        for journal in (self._journal(self.other_company, 'sale'), self.bank, self.sale_journal.browse(999999)):
            with self.subTest(journal=journal.id):
                self.assertRefused(self.onboard(journal), 404, 'not_found')
        self.assertEqual(self.zatca.calls, [])

    def test_the_capabilities_gate_every_route(self):
        url = f'/api/v1/finance/zatca/journals/{self.sale_journal.id}/onboard'
        for login in ('zatca_reader', OUTSIDER_LOGIN):
            self.authenticate(login, OUTSIDER_PASSWORD if login == OUTSIDER_LOGIN else 'finance_write_pass_123')
            with self.subTest(login=login), self.zatca.patched():
                self.assertRefused(self.api('POST', url, json={'otp': '123345'}), 403, 'forbidden')
        self.assertEqual(self.zatca.calls, [])
        self.login_as('zatca_reader')
        self.assertEqual(self.api('GET', STATUS).status_code, 200)
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', STATUS), 403, 'forbidden')

    def test_a_closed_feature_refuses_the_routes(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.assertEqual(self.api('GET', STATUS).status_code, 403)
        self.assertEqual(self.onboard().status_code, 403)


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaSubmission(LiwanZatcaCase):

    def setUp(self):
        super().setUp()
        self.onboarded_journal()

    def _state(self, invoice):
        result = self.api('GET', f'/api/v1/finance/invoices/{invoice["id"]}/zatca')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()), SUBMISSION_KEYS)
        return result.json()

    def test_a_posted_invoice_waits_until_it_is_submitted(self):
        invoice = self.sale_invoice()
        state = self._state(invoice)
        self.assertEqual((state['state'], state['mode'], state['errors'], state['warnings']), ('pending', 'clearance', [], []))

    def test_a_standard_invoice_is_cleared(self):
        invoice = self.sale_invoice()
        result = self.submit(invoice)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['state'], body['mode'], body['errors'], body['warnings']), ('accepted', 'clearance', [], []))
        self.assertTrue(body['qr_present'])
        self.assertEqual(self.zatca.endpoints()[-1], 'invoices/clearance/single')
        self.assertNoSecrets(result)
        self.assertEqual(self._state(invoice), body)
        detail = self.api('GET', f'/api/v1/finance/invoices/{invoice["id"]}').json()
        self.assertEqual(detail['zatca']['submission'], body)

    def test_a_simplified_invoice_is_reported(self):
        invoice = self.sale_invoice(self.b2c_buyer)
        body = self.submit(invoice).json()
        self.assertEqual((body['state'], body['mode']), ('accepted', 'reporting'))
        self.assertEqual(self.zatca.endpoints()[-1], 'invoices/reporting/single')

    def test_acceptance_with_warnings_lists_them(self):
        def accepted_with_warnings(body):
            cleared = json.loads(FakeZatca._clearance(body).text)
            return reply(202, {**cleared, 'validationResults': results('WARNING', warnings=[WARNING])})

        self.zatca.answers['invoices/clearance/single'] = accepted_with_warnings
        body = self.submit(self.sale_invoice()).json()
        self.assertEqual(body['state'], 'accepted')
        self.assertEqual(body['warnings'], [{'code': WARNING['code'], 'message': WARNING['message']}])

    def test_a_rejected_invoice_answers_422_with_the_errors_and_can_be_retried(self):
        invoice = self.sale_invoice()
        self.zatca.answers['invoices/clearance/single'] = answer(400, {'validationResults': results('ERROR', errors=[ERROR])})
        result = self.submit(invoice)
        self.assertRefused(result, 422, 'zatca_rejected')
        submission = result.json()['details']['submission']
        self.assertEqual((submission['state'], submission['errors']), ('rejected', [{'code': ERROR['code'], 'message': ERROR['message']}]))
        self.assertEqual(self._state(invoice), submission)
        self.assertRefused(self.submit(invoice), 422, 'invalid_state')
        self.zatca.answers.clear()
        retried = self.submit(invoice, 'retry')
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json()['state'], 'accepted')

    def test_zatca_down_keeps_the_invoice_retryable_without_leaking_the_response(self):
        invoice = self.sale_invoice()
        self.zatca.answers['invoices/clearance/single'] = lambda _body: reply(503, None, text='UPSTREAM-RAW-BODY')
        result = self.submit(invoice)
        self.assertRefused(result, 502, 'zatca_unavailable')
        self.assertNotIn('UPSTREAM-RAW-BODY', result.text)
        self.assertEqual(result.json()['details']['submission']['state'], 'retry')
        self.assertEqual(self._state(invoice)['state'], 'retry')
        self.zatca.answers['invoices/clearance/single'] = unreachable
        self.assertRefused(self.submit(invoice, 'retry'), 502, 'zatca_unavailable')
        self.zatca.answers.clear()
        self.assertEqual(self.submit(invoice, 'retry').json()['state'], 'accepted')

    def test_the_submission_outcome_leaves_a_log_record_and_audit_events(self):
        invoice = self.sale_invoice()
        self.zatca.answers['invoices/clearance/single'] = lambda _body: reply(503, None, text='UPSTREAM-RAW-BODY')
        with self.assertLogs('odoo.addons.liwan_finance.models.zatca_service', 'INFO') as logs:
            self.assertRefused(self.submit(invoice), 502, 'zatca_unavailable')
            self.zatca.answers.clear()
            self.assertEqual(self.submit(invoice, 'retry').json()['state'], 'accepted')
        move = self.env['account.move'].browse(invoice['id'])
        self.assertEqual([record.levelname for record in logs.records], ['WARNING', 'INFO'])
        self.assertEqual(
            logs.records[0].getMessage(),
            f'finance.zatca.submitted company={self.company.id} move={move.id} user={self.manager.id} retry=False state=retry',
        )
        self.assertIn('state=accepted', logs.output[1])
        self.assertNotIn('UPSTREAM-RAW-BODY', ' '.join(logs.output))
        events = self.env['liwan.finance.audit.event'].search([('action', '=', 'zatca_submitted'), ('res_id', '=', move.id)], order='id')
        self.assertEqual(events.mapped('outcome'), ['retry', 'accepted'])

    def test_an_accepted_invoice_cannot_be_submitted_again(self):
        invoice = self.sale_invoice()
        self.submit(invoice)
        calls = len(self.zatca.calls)
        for action in ('submit', 'retry'):
            self.assertRefused(self.submit(invoice, action), 422, 'invalid_state')
        self.assertEqual(len(self.zatca.calls), calls)

    def test_a_draft_or_foreign_invoice_is_not_submitted(self):
        draft = self.create_invoice(self.invoice_body(partner_id=self.b2b_buyer.id))
        self.assertEqual(self._state(draft)['state'], 'not_applicable')
        self.assertRefused(self.submit(draft), 422, 'zatca_not_applicable')
        foreign = {'id': self.other_invoice.id}
        self.assertRefused(self.submit(foreign), 404, 'not_found')
        self.assertEqual(self.api('GET', f'/api/v1/finance/invoices/{foreign["id"]}/zatca').status_code, 404)
        self.assertEqual(self.zatca.endpoints().count('invoices/clearance/single'), 0)

    def test_a_journal_that_lost_its_onboarding_refuses_422(self):
        invoice = self.sale_invoice()
        self.sale_journal.sudo().l10n_sa_production_csid_json = False
        self.assertRefused(self.submit(invoice), 422, 'zatca_not_onboarded')

    def test_only_the_sandbox_api_mode_is_allowed(self):
        invoice = self.sale_invoice()
        self.force_api_mode('prod')
        calls = len(self.zatca.calls)
        self.assertRefused(self.submit(invoice), 422, 'zatca_mode_not_allowed')
        self.assertEqual(len(self.zatca.calls), calls)

    def test_the_capabilities_gate_the_submission(self):
        invoice = self.sale_invoice()
        for login in ('zatca_reader', OUTSIDER_LOGIN):
            self.authenticate(login, OUTSIDER_PASSWORD if login == OUTSIDER_LOGIN else 'finance_write_pass_123')
            for action in ('submit', 'retry'):
                with self.subTest(login=login, action=action):
                    self.assertRefused(self.submit(invoice, action), 403, 'forbidden')
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', f'/api/v1/finance/invoices/{invoice["id"]}/zatca'), 403, 'forbidden')
        self.login_as('zatca_submitter')
        self.assertEqual(self.submit(invoice).json()['state'], 'accepted')

    def test_a_custom_role_with_the_submit_capability_can_submit_and_the_audit_row_is_written(self):
        self.onboarded_journal()
        invoice = self.sale_invoice()
        self.user_with('zatca_custom_submitter', ['finance.zatca.read', 'finance.zatca.submit', 'finance.invoices.read'])
        self.login_as('zatca_custom_submitter')
        self.assertEqual(self.submit(invoice).json()['state'], 'accepted')
        event = self.env['liwan.finance.audit.event'].search([('action', '=', 'zatca_submitted'), ('res_id', '=', invoice['id'])])
        self.assertEqual((event.outcome, event.create_uid.login), ('accepted', 'zatca_custom_submitter'))

    def test_the_service_checks_the_capability_itself(self):
        service = self.env['liwan.finance.zatca'].with_user(self.reader).with_company(self.company)
        with self.assertRaises(AccessError):
            service._liwan_submit(self.invoice.id, False)
        with self.assertRaises(AccessError):
            service._liwan_onboard(self.sale_journal.id, '123456')

    def _document(self, invoice):
        return self.env['account.move'].browse(invoice['id']).edi_document_ids

    def test_zatca_warning_codes_on_a_pending_document_are_shown_not_hidden(self):
        invoice = self.sale_invoice()
        self._document(invoice).write({
            'blocking_level': 'warning', 'error': '<b>[202] </b><b>BR-KSA-08</b> : seller id &amp; scheme <br/>',
        })
        state = self._state(invoice)
        self.assertEqual(state['state'], 'retry')
        self.assertEqual(state['errors'], [{'code': 'BR-KSA-08', 'message': 'seller id & scheme'}])

    def test_a_local_failure_is_blocked_and_never_echoes_a_dumped_response(self):
        invoice = self.sale_invoice()
        document = self._document(invoice)
        document.write({'blocking_level': 'error', 'error': 'Error: This invoice is blocked due to INV/1. Please check it.'})
        state = self._state(invoice)
        self.assertEqual((state['state'], state['errors']), (
            'blocked', [{'code': None, 'message': 'Error: This invoice is blocked due to INV/1. Please check it.'}],
        ))
        document.write({'error': "Invoice could not be cleared:\n{'clearedInvoice': 'RAW-SECRET'}"})
        state = self._state(invoice)
        self.assertEqual(state['state'], 'blocked')
        self.assertNotIn('RAW-SECRET', json.dumps(state))

    def test_an_unexpected_clearance_verdict_is_a_local_error_422(self):
        invoice = self.sale_invoice()
        self.zatca.answers['invoices/clearance/single'] = answer(200, {'clearanceStatus': 'NOT_CLEARED', 'validationResults': results()})
        result = self.submit(invoice)
        self.assertRefused(result, 422, 'zatca_local_error')
        self.assertEqual(result.json()['details']['submission']['state'], 'blocked')
        self.assertNotIn('NOT_CLEARED', result.text)

    def test_a_refused_certificate_asks_to_onboard_again(self):
        invoice = self.sale_invoice()
        self.zatca.answers['invoices/clearance/single'] = lambda _body: reply(401, None, text='RAW-ZATCA-401-BODY')
        result = self.submit(invoice)
        self.assertRefused(result, 422, 'zatca_unauthorized')
        self.assertNotIn('RAW-ZATCA-401-BODY', result.text)
        self.assertIn('onboard the journal again', result.json()['message'])
        self.assertEqual(self._state(invoice)['state'], 'unauthorized')

    def test_a_document_being_sent_by_another_process_is_422_invalid_state(self):
        invoice = self.sale_invoice()
        busy = UserError('This document is being sent by another process already. ')
        with patch.object(type(self.env['account.move']), 'action_process_edi_web_services', side_effect=busy):
            self.assertRefused(self.submit(invoice), 422, 'invalid_state')

    def test_the_read_capability_needs_the_invoices_read_capability(self):
        dependencies = self.env['liwan.access.service']._liwan_permission_dependencies()
        self.assertEqual(dependencies['finance.zatca.read'], {'finance.invoices.read'})
        self.assertIn('finance.zatca.read', dependencies['finance.zatca.manage'])
        self.assertIn('finance.zatca.read', dependencies['finance.zatca.submit'])


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaApiModeGuard(LiwanZatcaCase):

    def test_a_company_can_only_be_set_to_the_sandbox_mode(self):
        for mode in ('preprod', 'prod'):
            with self.subTest(mode), self.assertRaises(ValidationError), self.env.cr.savepoint():
                self.company.l10n_sa_api_mode = mode
        self.company.l10n_sa_api_mode = 'sandbox'
        self.assertEqual(self.company.l10n_sa_api_mode, 'sandbox')


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaWorkList(LiwanZatcaCase):
    """The work list of the e-invoices ZATCA has not accepted."""

    DOCUMENTS = '/api/v1/finance/zatca/documents'

    def waiting_invoices(self):
        self.onboarded_journal()
        pending, retry, rejected, blocked = (self.sale_invoice() for _index in range(4))
        for invoice, level, error in (
            (retry, 'warning', 'ZATCA could not be reached'),
            (rejected, 'error', '<p>BR-KSA-F-06-C01 : The invoice type code is not valid</p>'),
            (blocked, 'error', 'signing failed'),
        ):
            self.env['account.move'].browse(invoice['id']).edi_document_ids.write({'blocking_level': level, 'error': error})
        return {'pending': pending, 'retry': retry, 'rejected': rejected, 'blocked': blocked}

    def test_the_list_holds_every_unaccepted_document_with_its_state(self):
        invoices = self.waiting_invoices()
        body = self.api('GET', self.DOCUMENTS).json()
        self.assertEqual(body['total'], 4)
        states = {item['invoice']['id']: item['submission']['state'] for item in body['items']}
        self.assertEqual(states, {invoices[name]['id']: name for name in invoices})
        item = next(item for item in body['items'] if item['submission']['state'] == 'rejected')
        self.assertEqual(item['submission']['errors'][0]['code'], 'BR-KSA-F-06-C01')
        self.assertEqual(set(item), {'invoice', 'partner', 'date', 'amount_total', 'move_type', 'submission'})
        self.assertEqual(secret_keys(body), set())

    def test_the_list_is_filtered_by_state_and_never_holds_another_company(self):
        invoices = self.waiting_invoices()
        self.env['account.edi.document'].create({
            'move_id': self.other_invoice.id, 'edi_format_id': self.env.ref('l10n_sa_edi.edi_sa_zatca').id, 'state': 'to_send',
        })
        only = self.api('GET', f'{self.DOCUMENTS}?state=rejected').json()
        self.assertEqual([item['invoice']['id'] for item in only['items']], [invoices['rejected']['id']])
        self.assertEqual(self.api('GET', self.DOCUMENTS).json()['total'], 4)
        self.assertRefused(self.api('GET', f'{self.DOCUMENTS}?state=accepted'), 422, 'invalid', 'state')

    def test_a_document_leaves_the_list_once_zatca_accepts_it(self):
        invoices = self.waiting_invoices()
        self.env['account.move'].browse(invoices['pending']['id']).edi_document_ids.write({'state': 'sent'})
        ids = [item['invoice']['id'] for item in self.api('GET', self.DOCUMENTS).json()['items']]
        self.assertNotIn(invoices['pending']['id'], ids)

    def test_the_list_needs_the_zatca_read_capability(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', self.DOCUMENTS), 403, 'forbidden')
