# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .write_common import INVOICES, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaMapping(LiwanFinanceWriteCase):
    """The post refusal and the journal readiness helper are patched in; the mapping under
    test (``write_support.refusal``) is the real one. The real refusal is covered by
    ``TestFinanceZatcaRealModule``.
    """

    REFUSAL = 'Invalid invoice configuration:\n\n- The Journal (Customer Invoices) is not onboarded yet.'

    def _post(self, ready):
        draft = self.create_invoice()
        journal = type(self.env['account.journal'])
        move = type(self.env['account.move'])

        def refuse(moves, *args, **kwargs):
            raise UserError(self.REFUSAL)

        with (
            patch.object(journal, '_l10n_sa_ready_to_submit_einvoices', lambda records: ready),
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
