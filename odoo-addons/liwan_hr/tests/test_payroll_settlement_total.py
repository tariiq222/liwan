# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase
from odoo.addons.liwan_hr.rules import LiwanHrRule

EOS = '/api/v1/hr/payroll/eos'
DEPARTURE = date(2026, 11, 30)


@tagged('post_install', '-at_install', 'liwan')
class TestSettlementTotal(PayrollCase):
    """A settlement that owes nothing is refused where it is saved, not when the whole month is approved."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(
            cls, 'negative_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'],
        )
        cls.leaver = cls.make_employee(cls, 'Negative Leaver', start=date(2023, 12, 1))
        cls.set_compensation(
            cls, cls.leaver, 10000, 500, gosi_registration_date=date(2020, 1, 1),
        )
        cls.leaver.write({
            'departure_date': DEPARTURE,
            'departure_reason_id': cls.env.ref('hr.departure_resigned').id,
        })
        cls.Settlement = cls.env['liwan.hr.payroll.eos.settlement']

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _settlement_values(self, total):
        """A stored settlement row of the leaver, with ``total`` written directly past the route."""
        return {
            'employee_id': self.leaver.id, 'departure_date': DEPARTURE, 'case': 'resignation',
            'award': 100, 'leave_amount': 0, 'open_deductions': 5000, 'total': total,
        }

    def test_a_settlement_with_a_negative_total_is_refused_at_the_model(self):
        with self.assertRaises(LiwanHrRule) as refused:
            self.Settlement.create(self._settlement_values(-4900))
        self.assertEqual(refused.exception.code, 'settlement_negative')
        self.assertEqual(refused.exception.status, 422)
        self.assertEqual(refused.exception.field, 'open_deductions')
        self.assertFalse(self.Settlement.search([('employee_id', '=', self.leaver.id)]))

    def test_a_stored_negative_total_is_refused_on_write_too(self):
        draft = self.Settlement.create({**self._settlement_values(0), 'total': 0, 'open_deductions': 0})
        with self.assertRaises(LiwanHrRule) as refused:
            draft.write({'total': -1})
        self.assertEqual(refused.exception.code, 'settlement_negative')
        self.assertEqual(draft.total, 0)

    def test_a_settlement_that_owes_nothing_at_all_is_accepted(self):
        draft = self.Settlement.create({
            'employee_id': self.leaver.id, 'departure_date': DEPARTURE, 'case': 'resignation',
            'award': 0, 'leave_amount': 0, 'open_deductions': 0, 'total': 0,
        })
        self.assertEqual(draft.total, 0)

    def test_the_settlement_route_refuses_a_total_the_deductions_make_negative(self):
        """The award and encashment of this leaver do not cover the deductions the officer enters."""
        self._login(self.officer)
        res = self.api('PUT', f'{EOS}/{self.leaver.id}/settlement', json={
            'case': 'resignation', 'open_deductions': 100000,
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'settlement_negative')
        self.assertEqual(res.json()['field'], 'open_deductions')
        self.assertFalse(self.Settlement.search([('employee_id', '=', self.leaver.id)]))

    def test_the_route_keeps_the_saved_draft_positive_figure_when_the_new_one_is_negative(self):
        """The refusal never leaves a negative row behind: the draft the officer already saved stays as it was."""
        self._login(self.officer)
        saved = self.api('PUT', f'{EOS}/{self.leaver.id}/settlement', json={
            'case': 'resignation', 'open_deductions': 300,
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        res = self.api('PUT', f'{EOS}/{self.leaver.id}/settlement', json={
            'case': 'resignation', 'open_deductions': 100000,
        })
        self.assertEqual(res.status_code, 422, res.text)
        stored = self.Settlement.search([('employee_id', '=', self.leaver.id)])
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored.open_deductions, 300)
        self.assertEqual(stored.total, saved.json()['total'])
        self.assertGreater(stored.total, 0)
