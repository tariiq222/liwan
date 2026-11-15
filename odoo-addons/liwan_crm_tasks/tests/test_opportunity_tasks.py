# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_crm.tests.common import LiwanCrmCase

DEADLINE = '2026-12-01T09:00:00Z'


def url(lead):
    return f'/api/v1/crm/opportunities/{lead.id}/tasks'


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityTasks(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The CRM roles replace the employee role: give the three CRM users the to-do list back.
        employee = cls.env.ref('liwan_core.role_employee')
        for user, crm_role in ((cls.agent, 'agent'), (cls.agent2, 'agent'), (cls.manager, 'manager')):
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [
                {'role_id': cls.env.ref(f'liwan_crm.role_crm_{crm_role}').id, 'company_id': cls.company.id},
                {'role_id': employee.id, 'company_id': cls.company.id},
            ])

    def create(self, user, lead, **body):
        return self.as_user(user).api('POST', url(lead), json={'name': 'Call back', 'date_deadline': DEADLINE, **body})

    def test_create_links_the_task_assigns_the_agent_and_lists_it(self):
        lead = self.make_lead(self.agent)
        response = self.create(self.agent, lead, priority='high')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual([person['id'] for person in body['assignees']], [self.agent.id])
        self.assertEqual(body['priority'], 'high')
        task = self.env['project.task'].browse(body['id'])
        self.assertEqual(task.lead_id, lead)
        self.assertTrue(task.liwan_personal)
        self.assertEqual(task.company_id, self.company)
        listed = self.as_user(self.agent).api('GET', url(lead))
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 1)
        item = listed.json()['items'][0]
        self.assertEqual((item['id'], item['source'], item['href']), (task.id, 'personal', f'/my-tasks/{task.id}'))

    def test_a_manager_assigns_another_user_and_the_default_is_the_agent_of_the_opportunity(self):
        lead = self.make_lead(self.agent)
        body = self.create(self.manager, lead).json()
        # Odoo adds the creator to the assignees of every task it creates.
        self.assertEqual({person['id'] for person in body['assignees']}, {self.agent.id, self.manager.id})
        body = self.create(self.manager, lead, assignees=[self.manager.id]).json()
        self.assertEqual([person['id'] for person in body['assignees']], [self.manager.id])

    def test_the_list_hides_tasks_the_caller_may_not_see_and_other_opportunities(self):
        lead = self.make_lead(self.agent)
        other = self.make_lead(self.agent)
        self.create(self.manager, lead, assignees=[self.manager.id])
        mine = self.create(self.agent, lead).json()
        self.create(self.agent, other)
        items = self.as_user(self.agent).api('GET', url(lead)).json()
        self.assertEqual([item['id'] for item in items['items']], [mine['id']])
        self.assertEqual(items['total'], 1)

    def test_validation(self):
        lead = self.make_lead(self.agent)
        self.as_user(self.agent)
        for body, field in (
            ({'name': 'x'}, 'date_deadline'),
            ({'name': 'x', 'date_deadline': DEADLINE, 'parent_id': 1}, 'parent_id'),
            ({'name': 'x', 'date_deadline': DEADLINE, 'assignees': [self.env.ref('base.user_root').id]}, 'assignees'),
            ({'date_deadline': DEADLINE}, 'name'),
        ):
            with self.subTest(body=body):
                response = self.api('POST', url(lead), json=body)
                self.assertEqual((response.status_code, response.json()['field']), (422, field), response.text)
        self.assertFalse(self.env['project.task'].search([('lead_id', '=', lead.id)]))

    def test_a_lead_id_in_the_body_never_redirects_the_link(self):
        lead = self.make_lead(self.agent)
        other = self.make_lead(self.agent)
        body = self.create(self.agent, lead, lead_id=other.id).json()
        self.assertEqual(self.env['project.task'].browse(body['id']).lead_id, lead)

    def test_lead_id_is_a_registered_link_field_and_never_a_write_field(self):
        self.assertIn('lead_id', self.env['project.task']._liwan_task_link_fields())
        lead = self.make_lead(self.agent)
        other = self.make_lead(self.agent)
        task = self.env['project.task'].browse(self.create(self.agent, lead).json()['id'])
        response = self.as_user(self.agent).api('PATCH', f'/api/v1/my-tasks/{task.id}', json={'lead_id': other.id})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'lead_id'), response.text)
        self.assertEqual(task.lead_id, lead)

    def test_a_date_only_deadline_is_stored_as_utc_midnight(self):
        # The service reads YYYY-MM-DD as 00:00 UTC (my_task_service._parse_deadline); the bridge does not change that.
        lead = self.make_lead(self.agent)
        body = self.create(self.agent, lead, date_deadline='2026-12-01').json()
        task = self.env['project.task'].browse(body['id'])
        self.assertEqual(task.date_deadline, datetime(2026, 12, 1, 0, 0))
        self.assertEqual(body['date_deadline'], '2026-12-01T00:00:00Z')

    def test_an_archived_opportunity_takes_no_task(self):
        lead = self.make_lead(self.agent)
        lead.active = False
        self.assertEqual(self.create(self.agent, lead).status_code, 422)

    def test_an_agent_cannot_add_a_task_to_the_opportunity_of_another_agent(self):
        self.set_settings(visibility='all')
        lead = self.make_lead(self.agent2)
        self.assertEqual(self.as_user(self.agent).api('GET', url(lead)).status_code, 200)
        self.assertEqual(self.create(self.agent, lead).status_code, 403)

    def test_a_hidden_foreign_or_missing_opportunity_is_404(self):
        self.set_settings(visibility='own')
        hidden = self.make_lead(self.agent2)
        foreign = self.make_lead(None, company=self.other_company)
        self.as_user(self.agent)
        for lead_id in (hidden.id, foreign.id, 2 ** 30):
            for method in ('GET', 'POST'):
                with self.subTest(lead=lead_id, method=method):
                    response = self.api(method, f'/api/v1/crm/opportunities/{lead_id}/tasks',
                                        json={'name': 'x', 'date_deadline': DEADLINE} if method == 'POST' else None)
                    self.assertEqual(response.status_code, 404, response.text)
        self.assertFalse(self.env['project.task'].search([('lead_id', 'in', (hidden | foreign).ids)]))

    def test_tasks_of_another_company_are_never_listed(self):
        lead = self.make_lead(self.agent)
        foreign = self.env['project.task'].create({
            'name': 'Foreign', 'company_id': self.other_company.id, 'lead_id': lead.id,
            'user_ids': [Command.set([self.agent.id])],
        })
        listed = self.as_user(self.agent).api('GET', url(lead)).json()
        self.assertNotIn(foreign.id, [item['id'] for item in listed['items']])
        self.assertEqual(listed['total'], 0)

    def test_each_side_closed_refuses_both_routes_with_feature_not_included(self):
        lead = self.make_lead(self.agent)
        self.as_user(self.agent)
        for key in ('crm.enabled', 'tasks.enabled'):
            set_probe_feature(self, key=key, enabled=False)
            for method in ('GET', 'POST'):
                with self.subTest(feature=key, method=method):
                    response = self.api(method, url(lead), json={'name': 'x', 'date_deadline': DEADLINE} if method == 'POST' else None)
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assertEqual(response.json()['code'], 'feature_not_included')
            set_probe_feature(self, key=key, enabled=True)
        self.assertFalse(self.env['project.task'].search([('lead_id', '=', lead.id)]))

    def test_each_side_needs_its_capabilities(self):
        lead = self.make_lead(self.agent)
        self.set_settings(visibility='all')
        cases = (
            ('crm_only_read', ['crm.leads.read', 'crm.leads.work'], 'GET'),
            ('crm_only_write', ['crm.leads.read', 'crm.leads.work'], 'POST'),
            ('tasks_only_read', ['tasks.tasks.read', 'tasks.tasks.create'], 'GET'),
            ('tasks_only_write', ['tasks.tasks.read', 'tasks.tasks.create'], 'POST'),
            ('read_no_work', ['crm.leads.read', 'tasks.tasks.read', 'tasks.tasks.create'], 'POST'),
        )
        for login, keys, method in cases:
            user = new_test_user(self.env, login=login, password=f'{login}_pass_123', name=login, groups='base.group_user')
            role = self.env['liwan.access.role'].create({
                'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom', 'assignable': True,
                'permission_ids': [Command.set(self.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
            })
            self.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': self.company.id}])
            with self.subTest(login=login):
                response = self.as_user(user).api(method, url(lead), json={'name': 'x', 'date_deadline': DEADLINE} if method == 'POST' else None)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)

    def test_deleting_the_opportunity_leaves_the_task_unlinked_and_archiving_keeps_the_link(self):
        lead = self.make_lead(self.agent)
        task = self.env['project.task'].browse(self.create(self.agent, lead).json()['id'])
        lead.active = False
        self.assertEqual(task.lead_id, lead)
        lead.unlink()
        task.invalidate_recordset()
        self.assertTrue(task.exists())
        self.assertFalse(task.lead_id)
        self.assertTrue(task.liwan_personal)
