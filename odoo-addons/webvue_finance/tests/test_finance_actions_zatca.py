# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PASSWORD
from .zatca_common import WebVueZatcaCase


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceActionsZatca(WebVueZatcaCase):
    """The ZATCA facts that refuse an invoice action show on the record before the button is pressed."""

    def actions(self, invoice):
        result = self.api('GET', f'{INVOICES}/{invoice["id"]}')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        return set(body['allowed_actions']), {item['action']: item['reason'] for item in body['blocked_actions']}

    def test_a_draft_on_an_unonboarded_zatca_journal_cannot_be_posted(self):
        draft = self.create_invoice(self.invoice_body(partner_id=self.b2b_buyer.id))
        self.assertEqual(self.actions(draft), ({'edit', 'delete', 'cancel'}, {'post': 'zatca_not_onboarded'}))
        self.assertRefused(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}), 422, 'zatca_not_onboarded')

    def test_an_onboarded_journal_posts_and_waits_for_the_submission(self):
        self.onboarded_journal()
        invoice = self.sale_invoice()
        allowed, blocked = self.actions(invoice)
        self.assertIn('zatca_submit', allowed)
        self.assertNotIn('zatca_retry', allowed | set(blocked))
        self.assertNotIn('zatca_submit', blocked)
        self.assertEqual(self.submit(invoice).status_code, 200)
        allowed, blocked = self.actions(invoice)
        self.assertFalse({'zatca_submit', 'zatca_retry'} & (allowed | set(blocked)))

    def test_a_mode_other_than_the_sandbox_blocks_the_submission_as_the_route_refuses_it(self):
        self.onboarded_journal()
        invoice = self.sale_invoice()
        # The ORM refuses a mode other than the sandbox, so a tenant set up elsewhere is simulated in the column.
        self.env.cr.execute("UPDATE res_company SET l10n_sa_api_mode = 'preprod' WHERE id = %s", [self.company.id])
        self.company.invalidate_recordset(['l10n_sa_api_mode'])
        self.assertEqual(self.actions(invoice)[1], {'zatca_submit': 'zatca_mode_not_allowed'})
        self.assertRefused(self.submit(invoice), 422, 'zatca_mode_not_allowed')

    def test_a_journal_that_lost_its_onboarding_blocks_the_submission(self):
        self.onboarded_journal()
        invoice = self.sale_invoice()
        self.sale_journal.sudo().l10n_sa_production_csid_json = False
        self.assertEqual(self.actions(invoice)[1], {'zatca_submit': 'zatca_not_onboarded'})
        self.assertRefused(self.submit(invoice), 422, 'zatca_not_onboarded')

    def test_without_the_submit_capability_no_zatca_action_is_offered(self):
        self.onboarded_journal()
        invoice = self.sale_invoice()
        self.authenticate('zatca_reader', PASSWORD)
        allowed, blocked = self.actions(invoice)
        self.assertFalse({'zatca_submit', 'zatca_retry'} & (allowed | set(blocked)))

    def test_a_vendor_bill_is_not_applicable_rather_than_missing(self):
        bill = self.posted_invoice(self.bill_body())
        for action in ('submit', 'retry'):
            with self.subTest(action=action):
                self.assertRefused(self.submit(bill, action), 422, 'zatca_not_applicable')
