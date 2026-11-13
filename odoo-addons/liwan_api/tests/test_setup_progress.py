# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanApiCase

PASSWORD = 'setup_progress_pass_123'
ROUTE = '/api/v1/setup/progress'
KEYS = ['company', 'sector', 'channels', 'team', 'contacts']


@tagged('post_install', '-at_install', 'liwan')
class TestSetupProgress(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env['res.company']
        cls.company = cls.env.company
        cls.second = Company.create({'name': 'Setup second tenant'})
        cls.branch = Company.create({'name': 'Setup branch', 'parent_id': cls.company.id})
        role = cls.env.ref('liwan_core.role_system_admin')
        cls.admin = cls._user('setup_admin', cls.company, role)
        cls.second_admin = cls._user('setup_second_admin', cls.second, role)
        cls.branch_admin = cls._user('setup_branch_admin', cls.branch, role)
        cls.member = cls._user('setup_member', cls.company, cls.env.ref('liwan_core.role_employee'))
        reader_role = cls.env['liwan.access.role'].create({
            'key': 'setup_reader', 'name_ar': 'قارئ', 'name_en': 'Reader', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['liwan.access.permission'].search([('key', '=', 'settings.company.read')]).ids)],
        })
        cls.reader = cls._user('setup_reader', cls.company, reader_role)

    @classmethod
    def _user(cls, login, company, role):
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set([company.id])],
        )
        cls.env['liwan.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': company.id})
        return user

    def get(self, login):
        self.authenticate(login, PASSWORD)
        return self.api('GET', ROUTE)

    def put(self, login, payload):
        self.authenticate(login, PASSWORD)
        return self.api('PUT', ROUTE, payload)

    def step(self, body, key):
        return next(step for step in body['steps'] if step['key'] == key)

    def test_fresh_company_lists_the_five_steps_open(self):
        response = self.get('setup_admin')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'steps', 'closed_at', 'complete'})
        self.assertEqual([step['key'] for step in body['steps']], KEYS)
        for step in body['steps']:
            self.assertEqual(step, {'key': step['key'], 'outcome': None, 'recorded_by': None, 'recorded_at': None})
        self.assertIsNone(body['closed_at'])
        self.assertFalse(body['complete'])

    def test_put_sets_each_outcome_and_clears_it(self):
        body = self.put('setup_admin', {'step': 'company', 'outcome': 'done'}).json()
        step = self.step(body, 'company')
        self.assertEqual(step['outcome'], 'done')
        self.assertEqual(step['recorded_by'], {'id': self.admin.id, 'name': 'setup_admin'})
        self.assertRegex(step['recorded_at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        body = self.put('setup_admin', {'step': 'company', 'outcome': 'skipped'}).json()
        self.assertEqual(self.step(body, 'company')['outcome'], 'skipped')
        self.assertEqual(self.get('setup_admin').json(), body)
        body = self.put('setup_admin', {'step': 'company', 'outcome': None}).json()
        self.assertEqual(self.step(body, 'company'), {'key': 'company', 'outcome': None, 'recorded_by': None, 'recorded_at': None})

    def test_complete_counts_skipped_steps_and_needs_all_five(self):
        for key in KEYS[:-1]:
            body = self.put('setup_admin', {'step': key, 'outcome': 'skipped' if key == 'team' else 'done'}).json()
            self.assertFalse(body['complete'])
        body = self.put('setup_admin', {'step': 'contacts', 'outcome': 'skipped'}).json()
        self.assertTrue(body['complete'])
        body = self.put('setup_admin', {'step': 'contacts', 'outcome': None}).json()
        self.assertFalse(body['complete'])

    def test_close_and_reopen_keep_the_steps(self):
        self.put('setup_admin', {'step': 'sector', 'outcome': 'done'})
        body = self.put('setup_admin', {'closed': True}).json()
        self.assertRegex(body['closed_at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertEqual(self.step(body, 'sector')['outcome'], 'done')
        self.assertFalse(body['complete'])
        self.assertEqual(self.get('setup_admin').json()['closed_at'], body['closed_at'])
        body = self.put('setup_admin', {'closed': False}).json()
        self.assertIsNone(body['closed_at'])
        self.assertEqual(self.step(body, 'sector')['outcome'], 'done')

    def test_a_member_gets_403(self):
        self.assertEqual(self.get('setup_member').status_code, 403)
        self.assertEqual(self.put('setup_member', {'step': 'company', 'outcome': 'done'}).status_code, 403)
        self.assertEqual(self.put('setup_member', {'closed': True}).status_code, 403)

    def test_a_reader_reads_but_cannot_write(self):
        self.assertEqual(self.get('setup_reader').status_code, 200)
        self.assertEqual(self.put('setup_reader', {'step': 'company', 'outcome': 'done'}).status_code, 403)

    def test_unknown_step_outcome_or_shape_is_422(self):
        for payload, field in (
            ({'step': 'payroll', 'outcome': 'done'}, 'step'),
            ({'step': 'team', 'outcome': 'later'}, 'outcome'),
            ({'closed': 'yes'}, 'closed'),
        ):
            response = self.put('setup_admin', payload)
            self.assertEqual(response.status_code, 422, payload)
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], field)
        for payload in ({}, {'step': 'team'}, {'step': 'team', 'outcome': 'done', 'closed': True}):
            self.assertEqual(self.put('setup_admin', payload).status_code, 422, payload)

    def test_each_tenant_sees_only_its_own_progress(self):
        self.put('setup_admin', {'step': 'company', 'outcome': 'done'})
        self.put('setup_admin', {'closed': True})
        body = self.get('setup_second_admin').json()
        self.assertIsNone(self.step(body, 'company')['outcome'])
        self.assertIsNone(body['closed_at'])
        self.put('setup_second_admin', {'step': 'team', 'outcome': 'skipped'})
        body = self.get('setup_admin').json()
        self.assertIsNone(self.step(body, 'team')['outcome'])
        self.assertEqual(self.step(body, 'company')['outcome'], 'done')

    def test_a_branch_has_no_wizard(self):
        self.assertEqual(self.get('setup_branch_admin').status_code, 403)
        self.assertEqual(self.put('setup_branch_admin', {'closed': True}).status_code, 403)
