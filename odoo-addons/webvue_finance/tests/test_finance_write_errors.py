# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .write_common import INVOICES, WebVueFinanceWriteCase


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceZatcaMapping(WebVueFinanceWriteCase):
    """l10n_sa_edi is not installed in the test database, so its refusal is simulated.

    The post refusal and the journal readiness helper l10n_sa_edi adds are patched in; the
    mapping under test (``write_support.refusal``) is the real one. The real module needs a
    live ZATCA onboarding, which this task must not attempt.
    """

    REFUSAL = 'Invalid invoice configuration:\n\n- The Journal (Customer Invoices) is not onboarded yet.'

    def _post(self, ready):
        draft = self.create_invoice()
        journal = type(self.env['account.journal'])
        move = type(self.env['account.move'])

        def refuse(moves, *args, **kwargs):
            raise UserError(self.REFUSAL)

        with (
            patch.object(journal, '_l10n_sa_ready_to_submit_einvoices', lambda records: ready, create=True),
            patch.object(move, 'action_post', refuse),
        ):
            return draft, self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={})

    def test_a_post_refused_for_an_unonboarded_zatca_journal_is_422_zatca_not_onboarded(self):
        draft, result = self._post(ready=False)
        self.assertRefused(result, 422, 'zatca_not_onboarded')
        body = result.json()
        self.assertEqual(body['details'], {'detail': self.REFUSAL})
        self.assertEqual(self.env['account.move'].browse(draft['id']).state, 'draft')

    def test_the_same_refusal_with_an_onboarded_journal_stays_a_plain_invalid(self):
        _draft, result = self._post(ready=True)
        self.assertRefused(result, 422, 'invalid')
        self.assertEqual(result.json()['message'], self.REFUSAL)

    def test_without_l10n_sa_edi_a_refusal_is_a_plain_invalid(self):
        draft = self.create_invoice()

        def refuse(moves, *args, **kwargs):
            message = 'nope'
            raise UserError(message)

        with patch.object(type(self.env['account.move']), 'action_post', refuse):
            result = self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={})
        self.assertRefused(result, 422, 'invalid')
        self.assertNotIn('details', result.json())
