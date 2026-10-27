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

    def test_serialized_draft_run_has_null_finance_and_only_payroll_actions(self):
        # A draft run has no entry and offers no posting action, so the answer is the same with or without the
        # finance bridge: the bridge only adds actions from the approved state on (covered in webvue_hr_finance).
        shown = dump_run(self.payroll_run.with_user(self.officer))
        self.assertIsNone(shown['finance'])
        self.assertEqual(shown['allowed_actions'], ['compute', 'cancel', 'edit_inputs'])
        self.authenticate(self.officer.login, f'{self.officer.login}_pass_123')
        body = self.api('GET', f'{RUNS}/{self.payroll_run.id}').json()
        self.assertIsNone(body['finance'])
        self.assertEqual(body['allowed_actions'], ['compute', 'cancel', 'edit_inputs'])
