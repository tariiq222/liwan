# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import api
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .payroll_common import PayrollCase

MONTH_START = date(2026, 11, 1)
IBAN = 'SA0380000000608010167519'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollWriteRefusalAudit(PayrollCase):
    """A write the payroll guards refuse after approval leaves exactly one audit event (issue #520).

    The refusal raises, so the event is queued on the cursor's ``postcommit`` and written on its own cursor once
    the transaction commits. These tests run that queue and read the event back through a second cursor. Under
    ``HttpCase`` the registry hands out ``TestCursor`` instances over the one connection, so this proves the
    queued hook writes the event and that another cursor sees it; the separate real transaction a worker commits
    is Odoo's own path (``service_model.retrying`` -> ``cr.commit()`` -> ``postcommit.run()``), not exercised here.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'refusal_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'refusal_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.worker = cls.make_employee(cls, 'Refusal Worker')
        cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.Event = cls.env['liwan.hr.audit.event']

    def _approved_run(self):
        """One run approved through the section's own path, so its payslips are frozen exactly as in production."""
        run = self.env['hr.payslip.run']._liwan_create_month(MONTH_START)
        run._liwan_compute()
        run.with_user(self.approver)._liwan_approve()
        self.assertEqual(run.liwan_state, 'approved')
        return run.with_user(self.officer)

    def _queued(self):
        """The cursor's postcommit queue length: other layers queue their own writes, so tests use its delta."""
        return len(self.env.cr.postcommit)

    def _committed_events(self, action):
        """The events of ``action`` read back through a second cursor, before that cursor closes."""
        self.env.flush_all()
        cursor = self.registry.cursor()
        try:
            env = api.Environment(cursor, api.SUPERUSER_ID, {'allowed_company_ids': [self.env.company.id]})
            return [
                {
                    'res_model': event.res_model,
                    'res_id': event.res_id,
                    'create_uid': event.create_uid.id,
                    'changes': {change.field_name: (change.old_value, change.new_value) for change in event.change_ids},
                }
                for event in env['liwan.hr.audit.event'].search([('action', '=', action)], order='id')
            ]
        finally:
            cursor.rollback()
            cursor.close()

    def _assert_refused(self, action, record, fields, attempt):
        before = self._queued()
        with self.assertRaises(AccessError):
            attempt()
        # One queued write, not an event inside the refusal's own savepoint: that one the raise would roll back.
        self.assertEqual(self._queued() - before, 1, 'the refusal queued no audit write')
        self.env.cr.postcommit.run()
        events = self._committed_events(action)
        self.assertEqual(len(events), 1, events)
        event = events[0]
        self.assertEqual((event['res_model'], event['res_id']), (record._name, record.id))
        self.assertEqual(event['create_uid'], self.officer.id)
        self.assertEqual(set(event['changes']), set(fields))
        self.assertFalse(
            [value for pair in event['changes'].values() for value in pair if value], 'a value reached the trail',
        )

    # --- the frozen records ---------------------------------------------------------------------

    def test_a_refused_line_write_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        slip = run.slip_ids
        line = slip.line_ids[0]
        self._assert_refused(
            'payslip_write_refused', slip, ('total',),
            lambda: line.write({'total': 99999}),
        )
        self.assertNotEqual(line.total, 99999)

    def test_a_refused_payslip_write_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        slip = run.slip_ids
        before = slip.liwan_paid_days
        self._assert_refused(
            'payslip_write_refused', slip, ('liwan_paid_days',),
            lambda: slip.write({'liwan_paid_days': 1}),
        )
        self.assertEqual(slip.liwan_paid_days, before)

    def test_a_refused_input_write_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        slip = run.slip_ids
        entered = slip.input_line_ids[0]
        before = entered.amount
        self._assert_refused(
            'payslip_write_refused', slip, ('amount',),
            lambda: entered.write({'amount': 500}),
        )
        self.assertEqual(entered.amount, before)

    def test_a_refused_run_header_write_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        self._assert_refused(
            'run_write_refused', run, ('date_start',),
            lambda: run.write({'date_start': date(2026, 12, 1)}),
        )
        self.assertEqual(run.date_start, MONTH_START)

    def test_a_refused_run_unlock_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        self._assert_refused(
            'run_write_refused', run, ('liwan_state',),
            lambda: run.write({'liwan_state': 'draft'}),
        )
        self.assertEqual(run.liwan_state, 'approved')

    def test_a_refused_delete_of_an_approved_run_leaves_one_event(self):
        run = self._approved_run()
        self._assert_refused('run_write_refused', run, ('unlink',), run.unlink)
        self.assertTrue(run.exists())

    def test_the_queued_refusal_write_is_visible_to_another_cursor(self):
        """The refusal queues its event; running that queue makes the event visible to a second cursor.

        ``HttpCase`` already runs in registry test mode, so ``registry.cursor()`` hands out a ``TestCursor`` over
        the same connection (its ``commit`` only releases a savepoint). This therefore proves the queued hook
        writes the event and that another cursor reads it back, not that a separate transaction committed; the
        independent-cursor path in production is Odoo's own commit sequence (``service_model.retrying`` ->
        ``cr.commit()`` -> ``postcommit.run()``).

        A route cannot be the vehicle for this: every payroll route that could reach a frozen payslip refuses in
        ``_liwan_require_state`` with a 403 before the ORM guard runs (``_liwan_set_inputs``, ``_liwan_cancel``),
        so the route path raises no ``AccessError`` from the model and queues no refusal event. The guard this
        covers is the one a support script or a maintenance task meets when it writes through the ORM.
        """
        run = self._approved_run()
        slip = run.slip_ids
        self.env.flush_all()
        before = self._queued()
        with self.assertRaises(AccessError):
            slip.write({'liwan_paid_days': 1})
        self.assertEqual(self._queued() - before, 1)
        self.env.cr.postcommit.run()
        events = self._committed_events('payslip_write_refused')
        self.assertEqual(len(events), 1, events)
        self.assertEqual((events[0]['res_model'], events[0]['res_id']), ('hr.payslip', slip.id))
        self.assertEqual(events[0]['create_uid'], self.officer.id)
        self.assertEqual(set(events[0]['changes']), {'liwan_paid_days'})

    # --- what must stay silent -------------------------------------------------------------------

    def test_a_permitted_write_of_an_editable_run_leaves_no_event(self):
        run = self.env['hr.payslip.run']._liwan_create_month(MONTH_START)
        self.assertEqual(run.liwan_state, 'draft')
        run.with_user(self.officer).write({'date_start': run.date_start})
        before = self._queued()
        run.slip_ids.with_user(self.officer).write({'liwan_paid_days': 2})
        self.assertEqual(self._queued(), before)
        self.assertFalse(self.Event.search_count([
            ('action', 'in', ('payslip_write_refused', 'run_write_refused')),
        ]))

    def test_each_refused_write_logs_its_own_event(self):
        """Two attempts in one transaction are two facts, and one attempt is never logged twice."""
        run = self._approved_run()
        logged = 0
        for entries in (1, 3):
            before = self._queued()
            for index in range(entries):
                with self.assertRaises(AccessError):
                    run.slip_ids.write({'liwan_paid_days': index + 1})
            self.assertEqual(self._queued() - before, entries)
            self.env.cr.postcommit.run()
            logged += entries
            self.assertEqual(len(self._committed_events('payslip_write_refused')), logged)
