# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

JOB_KEYS = {'id', 'name', 'department', 'no_of_recruitment', 'application_count', 'description', 'active'}
STAGE_KEYS = {'id', 'name', 'sequence', 'hired_stage', 'fold'}
APPLICANT_KEYS = {
    'id', 'partner_name', 'email_from', 'partner_phone', 'job', 'department', 'stage', 'status',
    'priority', 'availability', 'refuse_reason', 'employee', 'applied_on', 'active',
}
REF_KEYS = {'id', 'name'}
HIRE_KEYS = {'applicant', 'employee'}
# Never serialized: compensation, UTM, attachments, properties, notes and interviewers.
APPLICANT_EXCLUDED_KEYS = (
    'salary_expected', 'salary_proposed', 'linkedin_profile', 'applicant_notes',
    'interviewer_ids', 'campaign_id', 'attachment_ids', 'talent_pool_ids',
)


@tagged('post_install', '-at_install', 'webvue')
class TestHrRecruitment(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.recruiter = new_test_user(
            cls.env, login='hr_recruiter', password='hr_recruiter_pass_123',
            name='Recruiter', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.recruiter, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': company.id,
        }])
        cls.department = cls.env['hr.department'].create({'name': 'Engineering', 'company_id': company.id})
        cls.job = cls.env['hr.job'].create({
            'name': 'Backend Engineer', 'department_id': cls.department.id, 'no_of_recruitment': 2,
        })
        cls.other_job = cls.env['hr.job'].create({'name': 'Designer', 'company_id': company.id})
        # Set-up uses the model's own ordering: the computed first stage of a job must match it.
        cls.stage = cls.env['hr.recruitment.stage'].search(
            [('job_ids', '=', False), ('fold', '=', False)], order='sequence asc', limit=1,
        )
        cls.refuse_reason = cls.env.ref('hr_recruitment.refuse_reason_1')

    def _user_with_capabilities(self, login, name, capabilities):
        """A user whose only HR access is the given recruitment capabilities."""
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        role = self.env['webvue.access.role'].create({
            'key': f'recruitment_{login}', 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', capabilities),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])
        return user

    def _applicant(self, name='Layla', **overrides):
        vals = {'partner_name': name, 'job_id': self.job.id, 'email_from': f'{name.lower()}@example.com'}
        vals.update(overrides)
        return self.env['hr.applicant'].create(vals)

    def _first_stage_of(self, job):
        return self.env['hr.recruitment.stage'].search(
            ['|', ('job_ids', '=', False), ('job_ids', '=', job.id), ('fold', '=', False)],
            order='sequence asc', limit=1,
        )

    def _as_recruiter(self):
        self.authenticate('hr_recruiter', 'hr_recruiter_pass_123')

    # --- jobs ------------------------------------------------------------------------------------

    def test_recruiter_lists_jobs_with_webvue_application_counts(self):
        self._applicant('Ongoing')
        self.env['hr.applicant'].create({
            'partner_name': 'Hired', 'job_id': self.other_job.id,
            'stage_id': self.env.ref('hr_recruitment.stage_job5').id,
        })
        refused = self._applicant('Refused')
        refused.write({'refuse_reason_id': self.refuse_reason.id, 'active': False})
        self._as_recruiter()
        res = self.api('GET', '/api/v1/hr/recruitment/jobs')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertGreaterEqual(body['total'], 2)
        job = next(item for item in body['items'] if item['id'] == self.job.id)
        self.assertEqual(set(job), JOB_KEYS)
        self.assertEqual(job['name'], 'Backend Engineer')
        self.assertEqual(job['department'], {'id': self.department.id, 'name': 'Engineering'})
        self.assertEqual(job['no_of_recruitment'], 2)
        # The hired and the refused applicant are not ongoing.
        self.assertEqual(job['application_count'], 1)
        self.assertEqual(job['description'], '')
        self.assertTrue(job['active'])
        detail = self.api('GET', f'/api/v1/hr/recruitment/jobs/{self.job.id}')
        self.assertEqual((detail.status_code, set(detail.json())), (200, JOB_KEYS))

    def test_job_active_filter_and_pagination(self):
        self.job.write({'active': False})
        self._as_recruiter()
        default = self.api('GET', '/api/v1/hr/recruitment/jobs').json()
        self.assertNotIn(self.job.id, {item['id'] for item in default['items']})
        archived = self.api('GET', '/api/v1/hr/recruitment/jobs?active=false').json()
        self.assertIn(self.job.id, {item['id'] for item in archived['items']})
        every = self.api('GET', '/api/v1/hr/recruitment/jobs?active=all').json()
        self.assertIn(self.job.id, {item['id'] for item in every['items']})
        page = self.api('GET', '/api/v1/hr/recruitment/jobs?active=all&limit=1&offset=0').json()
        self.assertEqual(len(page['items']), 1)
        self.assertEqual(page['total'], every['total'])
        bad = self.api('GET', '/api/v1/hr/recruitment/jobs?active=maybe')
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'active'))

    def test_recruiter_creates_and_patches_a_job(self):
        self._as_recruiter()
        res = self.api('POST', '/api/v1/hr/recruitment/jobs', json={
            'name': 'QA Engineer', 'department_id': self.department.id,
            'no_of_recruitment': 3, 'description': '<p>Own the <b>test</b> plan</p>',
        })
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(set(body), JOB_KEYS)
        self.assertEqual(body['description'], 'Own the test plan')
        self.assertEqual(body['application_count'], 0)
        patched = self.api('PATCH', f'/api/v1/hr/recruitment/jobs/{body["id"]}', json={
            'name': 'Senior QA Engineer', 'active': False,
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['name'], 'Senior QA Engineer')
        self.assertFalse(patched.json()['active'])
        job = self.env['hr.job'].browse(body['id'])
        self.assertEqual((job.name, job.department_id, job.no_of_recruitment), ('Senior QA Engineer', self.department, 3))
        # 422: unknown key, empty patch, a value the field cannot hold, a foreign relation.
        for payload, field in (
            ({'name': 'Blocked', 'salary': 1}, 'salary'),
            ({}, None),
            ({'name': 'Blocked', 'no_of_recruitment': -1}, 'no_of_recruitment'),
            ({'name': 'Blocked', 'department_id': 'abc'}, 'department_id'),
            ({'name': 'Blocked', 'active': 'yes'}, 'active'),
        ):
            response = self.api('PATCH', f'/api/v1/hr/recruitment/jobs/{body["id"]}', json=payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))
            self.assertEqual(response.json()['code'], 'invalid')
            if field is None:
                self.assertNotIn('field', response.json())
            else:
                self.assertEqual(response.json()['field'], field)
        # `active` is a patch key only: a create payload may not carry it.
        created = self.api('POST', '/api/v1/hr/recruitment/jobs', json={'name': 'Blocked', 'active': True})
        self.assertEqual((created.status_code, created.json()['field']), (422, 'active'))

    # --- applicants ------------------------------------------------------------------------------

    def test_applicant_envelope_keys_and_filters(self):
        applicant = self._applicant('Layla', availability='2026-11-01')
        self.env['hr.applicant'].create({'partner_name': 'Other job', 'job_id': self.other_job.id})
        self._as_recruiter()
        body = self.api('GET', '/api/v1/hr/recruitment/applicants').json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertGreaterEqual(body['total'], 2)
        item = next(entry for entry in body['items'] if entry['id'] == applicant.id)
        self.assertEqual(set(item), APPLICANT_KEYS)
        self.assertEqual(item['partner_name'], 'Layla')
        self.assertEqual(item['email_from'], 'layla@example.com')
        self.assertEqual(item['job'], {'id': self.job.id, 'name': 'Backend Engineer'})
        self.assertEqual(item['department'], {'id': self.department.id, 'name': 'Engineering'})
        self.assertEqual(item['stage']['id'], self._first_stage_of(self.job).id)
        self.assertEqual(item['status'], 'ongoing')
        self.assertEqual(item['priority'], '0')
        self.assertEqual(item['availability'], '2026-11-01')
        self.assertIsNone(item['refuse_reason'])
        self.assertIsNone(item['employee'])
        self.assertTrue(item['applied_on'].endswith('Z'))
        self.assertTrue(item['active'])
        # Filters by job, stage and status, each with the current-company domain.
        scoped = self.api('GET', f'/api/v1/hr/recruitment/applicants?job_id={self.job.id}').json()
        self.assertEqual([entry['id'] for entry in scoped['items']], [applicant.id])
        staged = self.api('GET', f'/api/v1/hr/recruitment/applicants?stage_id={item["stage"]["id"]}').json()
        self.assertIn(applicant.id, {entry['id'] for entry in staged['items']})
        ongoing = self.api('GET', '/api/v1/hr/recruitment/applicants?status=ongoing').json()
        self.assertIn(applicant.id, {entry['id'] for entry in ongoing['items']})
        page = self.api('GET', '/api/v1/hr/recruitment/applicants?limit=1').json()
        self.assertEqual((len(page['items']), page['total']), (1, body['total']))
        detail = self.api('GET', f'/api/v1/hr/recruitment/applicants/{applicant.id}')
        self.assertEqual((detail.status_code, set(detail.json())), (200, APPLICANT_KEYS))

    def test_recruiter_creates_an_applicant(self):
        self._as_recruiter()
        res = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'Omar', 'job_id': self.job.id,
            'email_from': 'omar@example.com', 'partner_phone': '+966500000000',
            'availability': '2026-12-01',
        })
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(set(body), APPLICANT_KEYS)
        self.assertEqual(body['partner_phone'], '+966500000000')
        self.assertEqual(body['availability'], '2026-12-01')
        applicant = self.env['hr.applicant'].browse(body['id'])
        self.assertEqual(applicant.company_id, self.env.company)
        self.assertEqual(applicant.stage_id, self._first_stage_of(self.job))

    def test_stage_and_priority_patch(self):
        applicant = self._applicant('Nour')
        other_stage = self.env.ref('hr_recruitment.stage_job2')
        self._as_recruiter()
        res = self.api('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', json={
            'stage_id': other_stage.id, 'priority': '2',
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['stage'], {'id': other_stage.id, 'name': other_stage.name})
        self.assertEqual(res.json()['priority'], '2')
        applicant.invalidate_recordset(['stage_id', 'priority'])
        self.assertEqual(applicant.stage_id, other_stage)
        self.assertEqual(applicant.priority, '2')
        # A stage linked to another job position is not available for this applicant.
        foreign_stage = self.env['hr.recruitment.stage'].create({
            'name': 'Designer Screen', 'job_ids': [(6, 0, self.other_job.ids)],
        })
        scoped = self.api('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', json={
            'stage_id': foreign_stage.id,
        })
        self.assertEqual((scoped.status_code, scoped.json()['field']), (422, 'stage_id'))

    def test_refuse_records_the_reason_and_archives(self):
        applicant = self._applicant('Rana')
        self._as_recruiter()
        res = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/refuse', json={
            'refuse_reason_id': self.refuse_reason.id,
        })
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), APPLICANT_KEYS)
        self.assertEqual(body['refuse_reason'], {'id': self.refuse_reason.id, 'name': self.refuse_reason.name})
        self.assertEqual(body['status'], 'refused')
        self.assertFalse(body['active'])
        applicant.invalidate_recordset(['refuse_reason_id', 'active'])
        self.assertEqual(applicant.refuse_reason_id, self.refuse_reason)
        self.assertFalse(applicant.active)
        # An archived applicant stays readable and is listed under the refused filter.
        self.assertEqual(self.api('GET', f'/api/v1/hr/recruitment/applicants/{applicant.id}').status_code, 200)
        refused = self.api('GET', '/api/v1/hr/recruitment/applicants?status=refused').json()
        self.assertIn(applicant.id, {entry['id'] for entry in refused['items']})
        archived = self.api('GET', '/api/v1/hr/recruitment/applicants?status=archived').json()
        self.assertNotIn(applicant.id, {entry['id'] for entry in archived['items']})
        hire = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', json={})
        self.assertEqual((hire.status_code, hire.json()['field']), (422, 'refuse_reason_id'))
        # 422: an unknown reason and an unknown payload key.
        for payload, field in (({'refuse_reason_id': 999999}, 'refuse_reason_id'), ({'reason': 1}, 'reason'), ({}, 'refuse_reason_id')):
            response = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/refuse', json=payload)
            self.assertEqual((response.status_code, response.json()['field']), (422, field))

    def test_reset_returns_the_applicant_to_the_first_stage(self):
        applicant = self._applicant('Sara')
        applicant.write({
            'stage_id': self.env.ref('hr_recruitment.stage_job4').id,
            'refuse_reason_id': self.refuse_reason.id,
            'active': False,
        })
        self._as_recruiter()
        res = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/reset', json={})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        first_stage = self._first_stage_of(self.job)
        self.assertEqual(body['stage'], {'id': first_stage.id, 'name': first_stage.name})
        self.assertIsNone(body['refuse_reason'])
        # The stock method only re-stages and clears the reason: it does not unarchive,
        # so the applicant is now archived rather than ongoing (stock's Restore is
        # `action_unarchive` and is not part of this contract).
        self.assertFalse(body['active'])
        self.assertEqual(body['status'], 'archived')
        applicant.invalidate_recordset(['stage_id', 'refuse_reason_id'])
        self.assertEqual(applicant.stage_id, first_stage)
        self.assertFalse(applicant.refuse_reason_id)

    def test_hire_creates_an_employee_through_the_stock_conversion(self):
        applicant = self._applicant('Hana')
        self._as_recruiter()
        res = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', json={})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), HIRE_KEYS)
        self.assertEqual(set(body['employee']), REF_KEYS)
        self.assertEqual(set(body['applicant']), APPLICANT_KEYS)
        self.assertEqual(body['applicant']['employee'], body['employee'])
        employee = self.env['hr.employee'].browse(body['employee']['id'])
        self.assertTrue(employee.exists())
        self.assertEqual((employee.name, employee.job_id, employee.department_id), ('Hana', self.job, self.department))
        self.assertEqual(employee.company_id, self.env.company)
        again = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', json={})
        self.assertEqual((again.status_code, again.json()['field']), (422, 'employee_id'))

    def test_payload_errors_are_422_with_their_field(self):
        self._as_recruiter()
        cases = (
            ('POST', '/api/v1/hr/recruitment/applicants', {}, 'partner_name'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': '   ', 'job_id': self.job.id}, 'partner_name'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X'}, 'job_id'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': 'abc'}, 'job_id'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': 999999}, 'job_id'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': self.job.id, 'email_from': 'nope'}, 'email_from'),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': self.job.id, 'salary_expected': 1}, 'salary_expected'),
        )
        for method, path, payload, field in cases:
            response = self.api(method, path, json=payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))
            self.assertEqual((response.json()['code'], response.json()['field']), ('invalid', field))
        applicant = self._applicant('Dina')
        for method, path, payload, field in (
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {}, None),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'priority': '9'}, 'priority'),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'stage_id': 999999}, 'stage_id'),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'partner_name': '  '}, 'partner_name'),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'linkedin_profile': 'x'}, 'linkedin_profile'),
            # The two empty-body action routes still name the first unknown key.
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/reset', {'state': 'validate'}, 'state'),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', {'employee_id': 1}, 'employee_id'),
        ):
            response = self.api(method, path, json=payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))
            if field is None:
                self.assertNotIn('field', response.json())
            else:
                self.assertEqual(response.json()['field'], field)

    def test_stages_and_refuse_reasons_envelopes(self):
        self._as_recruiter()
        stages = self.api('GET', '/api/v1/hr/recruitment/stages').json()
        self.assertEqual(set(stages), {'items', 'total'})
        self.assertEqual(stages['total'], len(stages['items']))
        for item in stages['items']:
            self.assertEqual(set(item), STAGE_KEYS)
        specific = self.env['hr.recruitment.stage'].create({
            'name': 'Designer Screen', 'job_ids': [(6, 0, self.other_job.ids)],
        })
        scoped = self.api('GET', f'/api/v1/hr/recruitment/stages?job_id={self.job.id}').json()
        ids = {item['id'] for item in scoped['items']}
        self.assertIn(self.stage.id, ids)
        self.assertNotIn(specific.id, ids)
        reasons = self.api('GET', '/api/v1/hr/recruitment/refuse-reasons').json()
        self.assertEqual(set(reasons), {'items', 'total'})
        self.assertEqual(reasons['total'], len(reasons['items']))
        for item in reasons['items']:
            self.assertEqual(set(item), REF_KEYS)
        self.assertIn(self.refuse_reason.id, {item['id'] for item in reasons['items']})

    def test_salary_and_private_fields_are_never_serialized(self):
        applicant = self._applicant('Salma')
        applicant.write({
            'salary_expected': 12000, 'salary_proposed': 11000,
            'linkedin_profile': 'https://example.com/salma', 'applicant_notes': '<p>note</p>',
        })
        self._as_recruiter()
        item = next(
            entry for entry in self.api('GET', '/api/v1/hr/recruitment/applicants').json()['items']
            if entry['id'] == applicant.id
        )
        self.assertEqual(set(item), APPLICANT_KEYS)
        for key in APPLICANT_EXCLUDED_KEYS:
            self.assertNotIn(key, item)

    # --- gates -----------------------------------------------------------------------------------

    def test_employee_without_recruitment_capability_is_forbidden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in (
            '/api/v1/hr/recruitment/jobs',
            f'/api/v1/hr/recruitment/jobs/{self.job.id}',
            '/api/v1/hr/recruitment/stages',
            '/api/v1/hr/recruitment/refuse-reasons',
            '/api/v1/hr/recruitment/applicants',
        ):
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')
        applicant = self._applicant('Muna')
        for method, path, payload in (
            ('POST', '/api/v1/hr/recruitment/jobs', {'name': 'Blocked'}),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': self.job.id}),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'priority': '1'}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/refuse', {'refuse_reason_id': self.refuse_reason.id}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/reset', {}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')

    def test_read_only_recruitment_capability_cannot_write(self):
        applicant = self._applicant('Reem')
        self._user_with_capabilities('hr_recruitment_reader', 'Recruitment reader', ['hr.recruitment.read'])
        self.authenticate('hr_recruitment_reader', 'hr_recruitment_reader_pass_123')
        for path in ('/api/v1/hr/recruitment/jobs', '/api/v1/hr/recruitment/applicants', '/api/v1/hr/recruitment/stages'):
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        for method, path, payload in (
            ('POST', '/api/v1/hr/recruitment/jobs', {'name': 'Blocked'}),
            ('PATCH', f'/api/v1/hr/recruitment/jobs/{self.job.id}', {'name': 'Blocked'}),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': self.job.id}),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{applicant.id}', {'priority': '1'}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/refuse', {'refuse_reason_id': self.refuse_reason.id}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/reset', {}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')

    def test_hire_needs_employee_management_too(self):
        applicant = self._applicant('Mona')
        self._user_with_capabilities(
            'hr_recruitment_only', 'Recruitment only', ['hr.recruitment.read', 'hr.recruitment.manage'],
        )
        self.authenticate('hr_recruitment_only', 'hr_recruitment_only_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/hr/recruitment/applicants').status_code, 200)
        created = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'Recruitment Only', 'job_id': self.job.id,
        })
        self.assertEqual(created.status_code, 201, created.text)
        hire = self.api('POST', f'/api/v1/hr/recruitment/applicants/{applicant.id}/hire', json={})
        self.assertEqual(hire.status_code, 403, hire.text)
        self.assertEqual(hire.json()['code'], 'forbidden')

    def test_feature_off_answers_feature_not_included(self):
        set_hr_feature(self, 'hr.recruitment', False)
        self._as_recruiter()
        for method, path, payload in (
            ('GET', '/api/v1/hr/recruitment/jobs', None),
            ('GET', '/api/v1/hr/recruitment/applicants', None),
            ('POST', '/api/v1/hr/recruitment/applicants', {'partner_name': 'X', 'job_id': self.job.id}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 403, (path, res.text))
            self.assertEqual(res.json()['code'], 'feature_not_included')

    def test_another_company_records_are_not_found(self):
        other_company = self.env['res.company'].create({'name': 'Other Recruitment Co'})
        foreign_job = self.env['hr.job'].with_company(other_company).create({
            'name': 'Foreign Job', 'company_id': other_company.id,
        })
        foreign_applicant = self.env['hr.applicant'].with_company(other_company).create({
            'partner_name': 'Foreign', 'job_id': foreign_job.id, 'company_id': other_company.id,
        })
        self._as_recruiter()
        for method, path, payload in (
            ('GET', f'/api/v1/hr/recruitment/jobs/{foreign_job.id}', None),
            ('PATCH', f'/api/v1/hr/recruitment/jobs/{foreign_job.id}', {'name': 'X'}),
            ('GET', f'/api/v1/hr/recruitment/applicants/{foreign_applicant.id}', None),
            ('PATCH', f'/api/v1/hr/recruitment/applicants/{foreign_applicant.id}', {'priority': '1'}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{foreign_applicant.id}/refuse', {'refuse_reason_id': self.refuse_reason.id}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{foreign_applicant.id}/reset', {}),
            ('POST', f'/api/v1/hr/recruitment/applicants/{foreign_applicant.id}/hire', {}),
        ):
            res = self.api(method, path, json=payload)
            self.assertEqual(res.status_code, 404, (path, res.text))
            self.assertEqual(res.json()['code'], 'not_found')
        # A foreign relation id in a filter or a payload is a 422, never a silent empty list.
        filtered = self.api('GET', f'/api/v1/hr/recruitment/applicants?job_id={foreign_job.id}')
        self.assertEqual((filtered.status_code, filtered.json()['field']), (422, 'job_id'))
        created = self.api('POST', '/api/v1/hr/recruitment/applicants', json={
            'partner_name': 'X', 'job_id': foreign_job.id,
        })
        self.assertEqual((created.status_code, created.json()['field']), (422, 'job_id'))
        foreign_subject = self.api('GET', '/api/v1/hr/recruitment/applicants?q=Foreign').json()
        self.assertNotIn(foreign_applicant.id, {entry['id'] for entry in foreign_subject['items']})
