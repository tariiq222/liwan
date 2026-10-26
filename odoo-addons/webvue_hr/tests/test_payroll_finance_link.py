# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The base ``webvue.hr.payroll.finance.link`` extension point, as it behaves before the finance bridge."""
from odoo.tests import tagged

from .payroll_common import PayrollCase
from odoo.addons.webvue_hr.models.payroll_finance_link import WebVueHrPayrollFinanceLink
from odoo.addons.webvue_hr.serializers.payroll.run import dump_run

RUNS = '/api/v1/hr/payroll/runs'


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollFinanceLinkBase(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'link_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.payroll_run = cls.env['hr.payslip.run'].create({
            'name': 'Link run', 'date_start': '2026-04-01', 'date_end': '2026-04-30',
        })

    def test_base_hooks_offer_no_finance_reference_and_no_action(self):
        # Called on the base class itself, so the answer is the extension point's own, whether or not the
        # finance bridge happens to be installed in this database.
        link = self.env['webvue.hr.payroll.finance.link']
        self.assertIsNone(WebVueHrPayrollFinanceLink._webvue_finance_refs(link, self.payroll_run))
        self.assertEqual(WebVueHrPayrollFinanceLink._webvue_finance_actions(link, self.payroll_run), [])

    def test_serialized_run_without_the_bridge_has_null_finance_and_only_payroll_actions(self):
        installed = self.env['ir.module.module'].sudo().search_count([
            ('name', '=', 'webvue_hr_finance'), ('state', '=', 'installed'),
        ])
        if installed:
            # The bridge extends the hooks through super(); the base answer is covered by the test above.
            self.assertTrue(self.env['webvue.hr.payroll.finance.link']._webvue_finance_actions(self.payroll_run) is not None)
            return
        shown = dump_run(self.payroll_run)
        self.assertIsNone(shown['finance'])
        self.assertEqual(shown['allowed_actions'], [])
        self.authenticate(self.officer.login, f'{self.officer.login}_pass_123')
        body = self.api('GET', f'{RUNS}/{self.payroll_run.id}').json()
        self.assertIsNone(body['finance'])
        self.assertEqual(body['allowed_actions'], ['compute', 'cancel', 'edit_inputs'])
        self.assertNotIn('post', body['allowed_actions'])
