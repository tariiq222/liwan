# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

DEPARTURE_KEYS = {'employee', 'active', 'departure_date', 'reason', 'description', 'clearance'}
CLEARANCE_KEYS = {'run_id', 'done', 'total'}
RUN_KEYS = {'id', 'employee', 'plan', 'plan_date', 'launched_by', 'done', 'total', 'state', 'cancellation'}
MANAGER_KEYS = (
    'hr.employees.read', 'hr.employees.manage',
    'hr.offboarding.read', 'hr.offboarding.manage',
)
READER_KEYS = ('hr.employees.read', 'hr.offboarding.read')
TODO = 'mail.mail_activity_data_todo'
DEPARTURE_DATE = '2026-11-30'


@tagged('post_install', '-at_install', 'webvue')
class TestHrOffboarding(WebVueHrCase):
    """The resignation and clearance area over the stock departure flow."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.company.country_id = cls.env.ref('base.sa')
        cls.manager = cls._make_user('hr_offboarding_mgr', 'Offboarding Manager', MANAGER_KEYS)
        cls.reader = cls._make_user('hr_offboarding_reader', 'Offboarding Reader', READER_KEYS)
        cls.reason = cls.env.ref('hr.departure_resigned')
        cls.plan = cls.env.ref('hr.offboarding_plan')
        # The lead is the manager of the plan steps, so it needs a user; a plain
        # employee user keeps the manager's own employee unique (hr_employee_user_uniq).
        cls.lead_user = new_test_user(
            cls.env, login='hr_offboarding_lead', password='hr_offboarding_lead_pass_123',
            name='Offboarding Lead', groups='webvue_core.group_employee',
        )
        cls.lead = cls.env['hr.employee'].create({
            'name': 'Offboarding Lead', 'company_id': cls.company.id, 'user_id': cls.lead_user.id,
        })
        cls.employee_record = cls.env['hr.employee'].create({
            'name': 'Leaving Employee',
            'company_id': cls.company.id,
            'parent_id': cls.lead.id,
            'contract_date_start': '2020-01-01',
        })
        cls.own_employee = cls.env['hr.employee'].create({
            'name': 'Offboarding Manager Employee',
            'company_id': cls.company.id,
            'user_id': cls.manager.id,
            'parent_id': cls.lead.id,
            'contract_date_start': '2020-01-01',
        })

    @classmethod
    def _make_user(cls, login, name, capability_keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        role = cls.env['webvue.access.role'].create({
            'key': login, 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', capability_keys),
            ]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.env.company.id,
        }])
        return user

    def _as_manager(self):
        self.authenticate('hr_offboarding_mgr', 'hr_offboarding_mgr_pass_123')

    def _as_reader(self):
        self.authenticate('hr_offboarding_reader', 'hr_offboarding_reader_pass_123')

    def _register(self, *, employee=None, with_plan=True, departure_date=DEPARTURE_DATE):
        payload = {
            'employee_id': (employee or self.employee_record).id,
            'departure_date': departure_date,
            'departure_reason_id': self.reason.id,
            'description': 'استقالة شخصية',
        }
        if with_plan:
            payload['plan_id'] = self.plan.id
        return self.api('POST', '/api/v1/hr/offboarding/departures', json=payload)

    def test_reasons_are_references_of_the_company_country(self):
        self._as_reader()
        response = self.api('GET', '/api/v1/hr/offboarding/reasons')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(set(body['items'][0]), {'id', 'name'})
        self.assertIn(self.reason.id, {item['id'] for item in body['items']})

    def test_register_departure_writes_the_stock_fields_and_the_clearance(self):
        self._as_manager()
        response = self._register()
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(set(body), DEPARTURE_KEYS)
        self.assertEqual(set(body['clearance']), CLEARANCE_KEYS)
        self.assertEqual(body['employee'], {'id': self.employee_record.id, 'name': self.employee_record.name})
        self.assertEqual(body['departure_date'], DEPARTURE_DATE)
        self.assertEqual(body['reason'], {'id': self.reason.id, 'name': self.reason.name})
        self.assertEqual(body['description'], 'استقالة شخصية')
        self.assertTrue(body['active'])
        # The stock wizard wrote the departure and the contract end date.
        employee = self.employee_record
        self.assertEqual(str(employee.departure_date), DEPARTURE_DATE)
        self.assertEqual(employee.departure_reason_id, self.reason)
        self.assertEqual(str(employee.contract_date_end), DEPARTURE_DATE)
        # Registering a departure never archives the employee.
        self.assertTrue(employee.active)
        # The clearance is an offboarding plan run of the same request.
        self.assertEqual(body['clearance']['total'], len(self.plan.template_ids))
        self.assertEqual(body['clearance']['done'], 0)
        run = self.env['webvue.hr.plan.run'].browse(body['clearance']['run_id'])
        self.assertEqual(run.plan_id, self.plan)
        self.assertEqual(run.employee_id, employee)
        self.assertEqual(len(run.activity_ids), len(self.plan.template_ids))

    def test_clearance_step_completion_advances_the_departure(self):
        self._as_manager()
        body = self._register().json()
        run_id = body['clearance']['run_id']
        detail = self.api('GET', f'/api/v1/hr/offboarding/runs/{run_id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(set(detail.json()), RUN_KEYS | {'steps', 'can_cancel'})
        self.assertEqual(detail.json()['state'], 'open')
        steps = detail.json()['steps']
        self.assertTrue(all(step['can_complete'] for step in steps))

        done = self.api('POST', f"/api/v1/hr/offboarding/runs/{run_id}/steps/{steps[0]['id']}/done", json={})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()['done'], 1)

        departure = self.api('GET', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}')
        self.assertEqual(departure.status_code, 200, departure.text)
        self.assertEqual(departure.json()['clearance']['done'], 1)

    def test_departure_patch_updates_the_record(self):
        self._as_manager()
        self._register().json()
        response = self.api('PATCH', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}', json={
            'departure_date': '2026-12-15', 'description': 'محدث',
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['departure_date'], '2026-12-15')
        self.assertEqual(response.json()['description'], 'محدث')
        self.assertEqual(str(self.employee_record.departure_date), '2026-12-15')
        unknown = self.api('PATCH', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}', json={'active': False})
        self.assertEqual((unknown.status_code, unknown.json()['code']), (422, 'invalid'))
        empty = self.api('PATCH', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}', json={})
        self.assertEqual((empty.status_code, empty.json()['code']), (422, 'invalid'))

    def test_departures_list_and_unknown_departures(self):
        self._as_manager()
        self._register().json()
        listing = self.api('GET', '/api/v1/hr/offboarding/departures')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(set(listing.json()), {'items', 'total'})
        self.assertIn(self.employee_record.id, {item['employee']['id'] for item in listing.json()['items']})
        cleared = self.api('GET', '/api/v1/hr/offboarding/departures?cleared=true').json()
        self.assertNotIn(self.employee_record.id, {item['employee']['id'] for item in cleared['items']})
        uncleared = self.api('GET', '/api/v1/hr/offboarding/departures?cleared=false').json()
        self.assertIn(self.employee_record.id, {item['employee']['id'] for item in uncleared['items']})
        search = self.api('GET', '/api/v1/hr/offboarding/departures?q=Leaving').json()
        self.assertIn(self.employee_record.id, {item['employee']['id'] for item in search['items']})
        bad = self.api('GET', '/api/v1/hr/offboarding/departures?cleared=maybe')
        self.assertEqual((bad.status_code, bad.json()['code']), (422, 'invalid'))
        # An employee without a departure has no departure record.
        missing = self.api('GET', f'/api/v1/hr/offboarding/departures/{self.own_employee.id}')
        self.assertEqual((missing.status_code, missing.json()['code']), (404, 'not_found'))
        missing_patch = self.api('PATCH', f'/api/v1/hr/offboarding/departures/{self.own_employee.id}', json={'description': 'x'})
        self.assertEqual((missing_patch.status_code, missing_patch.json()['code']), (404, 'not_found'))

    def test_a_second_departure_registration_is_refused(self):
        self._as_manager()
        self._register().json()
        again = self._register(employee=self.employee_record, with_plan=False)
        self.assertEqual((again.status_code, again.json()['code']), (422, 'invalid'))
        self.assertEqual(again.json()['field'], 'departure_date')

    def test_the_caller_cannot_decide_on_their_own_employee(self):
        self._as_manager()
        own_departure = self._register(employee=self.own_employee, with_plan=False)
        self.assertEqual((own_departure.status_code, own_departure.json()['code']), (403, 'forbidden'))
        own_run = self.api('POST', '/api/v1/hr/offboarding/runs', json={
            'employee_id': self.own_employee.id, 'plan_id': self.plan.id,
        })
        self.assertEqual((own_run.status_code, own_run.json()['code']), (403, 'forbidden'))
        # A clearance run of the caller's own employee, with a step assigned to them.
        own_plan = self.env['mail.activity.plan'].create({
            'name': 'Own clearance', 'res_model': 'hr.employee', 'hr_purpose': 'offboarding',
            'company_id': self.company.id,
        })
        self.env['mail.activity.plan.template'].create({
            'plan_id': own_plan.id, 'summary': 'Hand over the badge',
            'activity_type_id': self.env.ref(TODO).id, 'responsible_type': 'other',
            'responsible_id': self.manager.id, 'delay_count': 0, 'delay_unit': 'days',
            'delay_from': 'before_plan_date',
        })
        run = self.env['webvue.hr.plan.run'].create({
            'employee_id': self.own_employee.id, 'plan_id': own_plan.id, 'plan_date': '2026-11-02',
        })
        activity = self.env['mail.activity'].create({
            'res_model_id': self.env['ir.model']._get_id('hr.employee'),
            'res_id': self.own_employee.id,
            'activity_type_id': self.env.ref(TODO).id, 'summary': 'Hand over the badge',
            'user_id': self.manager.id, 'date_deadline': '2026-11-02',
        })
        run.activity_ids = [Command.set([activity.id])]
        own_step = self.api('POST', f'/api/v1/hr/offboarding/runs/{run.id}/steps/{activity.id}/done', json={})
        self.assertEqual((own_step.status_code, own_step.json()['code']), (403, 'forbidden'))

    def test_write_routes_need_the_manage_capability(self):
        self._as_reader()
        response = self._register(with_plan=False)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.api('GET', '/api/v1/hr/offboarding/departures').status_code, 200)
        self.assertEqual(self.api('GET', '/api/v1/hr/offboarding/reasons').status_code, 200)

    def test_reader_reads_a_registered_departure(self):
        self._as_manager()
        self.assertEqual(self._register().status_code, 201)
        self._as_reader()
        listing = self.api('GET', '/api/v1/hr/offboarding/departures')
        self.assertEqual(listing.status_code, 200, listing.text)
        item = next(row for row in listing.json()['items'] if row['employee']['id'] == self.employee_record.id)
        self.assertEqual(set(item), DEPARTURE_KEYS)
        one = self.api('GET', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}')
        self.assertEqual(one.status_code, 200, one.text)
        self.assertEqual(set(one.json()), DEPARTURE_KEYS)
        self.assertEqual(one.json()['departure_date'], DEPARTURE_DATE)
        self.assertEqual(one.json()['reason'], {'id': self.reason.id, 'name': self.reason.name})

    def test_feature_gate_hides_the_area(self):
        self._as_manager()
        set_hr_feature(self, 'hr.offboarding', False)
        response = self.api('GET', '/api/v1/hr/offboarding/departures')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
        set_hr_feature(self, 'hr.offboarding', True)
        set_hr_feature(self, 'hr.enabled', False)
        response = self.api('GET', '/api/v1/hr/offboarding/reasons')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_another_company_departure_is_a_404(self):
        other_company = self.env['res.company'].create({'name': 'Offboarding Other Co'})
        foreign = self.env['hr.employee'].create({
            'name': 'Foreign Leaving', 'company_id': other_company.id,
            'departure_date': date(2026, 12, 1), 'departure_reason_id': self.reason.id,
            'contract_date_start': '2020-01-01',
        })
        self._as_manager()
        response = self.api('GET', f'/api/v1/hr/offboarding/departures/{foreign.id}')
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))
        register = self._register(employee=foreign, with_plan=False)
        self.assertEqual((register.status_code, register.json()['code']), (404, 'not_found'))
        self.assertNotIn(foreign.id, {
            item['employee']['id']
            for item in self.api('GET', '/api/v1/hr/offboarding/departures').json()['items']
        })

    def test_a_cancelled_clearance_is_no_clearance_and_ones_own_is_refused(self):
        self._as_manager()
        body = self._register().json()
        run_id = body['clearance']['run_id']
        cancelled = self.api('POST', f'/api/v1/hr/offboarding/runs/{run_id}/cancel', json={'reason': 'wrong plan'})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()['state'], 'cancelled')
        departure = self.api('GET', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}').json()
        self.assertIsNone(departure['clearance']['run_id'])

        own = self.env['webvue.hr.plan.run'].create({
            'employee_id': self.own_employee.id, 'plan_id': self.plan.id, 'plan_date': DEPARTURE_DATE,
        })
        refused = self.api('POST', f'/api/v1/hr/offboarding/runs/{own.id}/cancel', json={'reason': 'mine'})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.assertEqual(own.state, 'open')

    def test_cancelling_the_latest_clearance_does_not_restore_an_older_one(self):
        self._as_manager()
        body = self._register().json()
        older = self.env['webvue.hr.plan.run'].browse(body['clearance']['run_id'])
        older.with_context(active_test=False).activity_ids.action_feedback(feedback='done')
        newer = self.env['webvue.hr.plan.run'].create({
            'employee_id': self.employee_record.id, 'plan_id': self.plan.id, 'plan_date': '2099-01-01',
        })
        cancelled = self.api('POST', f'/api/v1/hr/offboarding/runs/{newer.id}/cancel', json={'reason': 'wrong plan'})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        departure = self.api('GET', f'/api/v1/hr/offboarding/departures/{self.employee_record.id}').json()
        self.assertIsNone(departure['clearance']['run_id'])
        cleared = self.api('GET', '/api/v1/hr/offboarding/departures?cleared=true').json()
        self.assertNotIn(self.employee_record.id, {item['employee']['id'] for item in cleared['items']})
