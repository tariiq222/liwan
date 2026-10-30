# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``GET /hr/payroll/eos-provisions`` needs BOTH payroll read and finance entries read (match='all')."""
from odoo.tests import tagged

from .common import PayrollFinanceCase

PROVISIONS = '/api/v1/hr/payroll/eos-provisions'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollEosProvisionGate(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.both = cls.user_with('pg_both', ['hr.payroll.read', 'finance.entries.read', 'hr.employees.read'])
        cls.payroll_only = cls.user_with('pg_payroll', ['hr.payroll.read', 'hr.employees.read'])
        cls.finance_only = cls.user_with('pg_finance', ['finance.entries.read', 'hr.employees.read'])

    def _get(self, user):
        self.login_as(user)
        return self.api('GET', PROVISIONS)

    def test_holder_of_both_capabilities_gets_the_empty_list(self):
        res = self._get(self.both)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), {'items': [], 'total': 0})

    def test_payroll_read_alone_is_forbidden(self):
        res = self._get(self.payroll_only)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'), res.text)

    def test_finance_read_alone_is_forbidden(self):
        res = self._get(self.finance_only)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'), res.text)
