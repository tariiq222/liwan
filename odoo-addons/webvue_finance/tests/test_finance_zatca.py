# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, WebVueFinanceWriteCase


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceZatcaRealModule(WebVueFinanceWriteCase):
    """Runs only in a database that has l10n_sa_edi installed (the module list of the run decides;
    a test never installs a module). The Saudi company's sales journal is not ZATCA-onboarded, so
    Odoo refuses to post and the route answers 422 ``zatca_not_onboarded``. No onboarding or
    network call is made.

    With l10n_sa_edi installed the shared fixture cannot post its sample invoices, so this class
    keeps them as drafts; run it alone: ``--test-tags /webvue_finance:TestFinanceZatcaRealModule``.
    """

    @classmethod
    def _sale_invoice(cls, company, partner):
        return cls._draft_sale_invoice(company, partner)

    def test_posting_on_a_journal_that_is_not_onboarded_is_a_422_zatca_not_onboarded(self):
        if not self.env['ir.module.module'].search_count([('name', '=', 'l10n_sa_edi'), ('state', '=', 'installed')]):
            self.skipTest('l10n_sa_edi is not installed in this database')
        draft = self.create_invoice()
        result = self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={})
        self.assertRefused(result, 422, 'zatca_not_onboarded')
        self.assertIn('not onboarded', result.json()['details']['detail'])
        self.assertEqual(self.env['account.move'].browse(draft['id']).state, 'draft')
