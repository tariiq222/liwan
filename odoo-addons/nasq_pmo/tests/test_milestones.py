# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .common import NasqPmoCase

KEYS = {
    'id', 'name', 'deadline', 'start_date', 'deliverables', 'is_reached',
    'reached_date', 'task_count', 'done_task_count',
}


@tagged('post_install', '-at_install', 'nasq')
class TestMilestones(NasqPmoCase):

    def _dated_project(self):
        return self.env['project.project'].create({
            'name': 'Dated charter project',
            'company_id': self.env.company.id,
            'user_id': self.manager.id,
            'date_start': date(2026, 10, 1),
            'date': date(2026, 10, 31),
        })

    def test_crud_and_rules(self):
        url = f'/api/v1/projects/{self.project.id}/milestones'
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', url).json(), [])
        self.assertEqual(self.api('POST', url, {'name': 'M'}).status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'name': 'M1', 'deadline': '2030-02-01'})
        self.assertEqual(res.status_code, 201)
        m1 = res.json()
        self.assertEqual(set(m1), KEYS)
        self.assertEqual((m1['deadline'], m1['is_reached'], m1['task_count']), ('2030-02-01', False, 0))
        m0 = self.api('POST', url, {'name': 'M0', 'deadline': '2030-01-01'}).json()
        mx = self.api('POST', url, {'name': 'MX'}).json()
        self.assertEqual([m['name'] for m in self.api('GET', url).json()], ['M0', 'M1', 'MX'])
        self.assertEqual(self.api('POST', url, {'name': 'bad', 'deadline': 'x'}).status_code, 422)
        self.env['project.task'].create({'name': 't', 'project_id': self.project.id, 'milestone_id': m1['id'], 'state': '1_done'})
        got = next(m for m in self.api('GET', url).json() if m['id'] == m1['id'])
        self.assertEqual((got['task_count'], got['done_task_count']), (1, 1))
        res = self.api('PATCH', f"{url}/{m1['id']}", {'is_reached': True, 'name': 'M1r', 'deadline': None})
        self.assertEqual((res.json()['is_reached'], res.json()['name'], res.json()['deadline']), (True, 'M1r', None))
        self.assertIsNotNone(res.json()['reached_date'])
        res = self.api('DELETE', f"{url}/{m1['id']}")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'milestone_has_tasks'))
        self.assertEqual(self.api('DELETE', f"{url}/{m0['id']}").status_code, 204)
        self.assertEqual(self.api('DELETE', f"{url}/{mx['id']}").status_code, 204)
        other = self.env['project.project'].create({'name': 'O'})
        foreign = self.env['project.milestone'].create({'name': 'F', 'project_id': other.id})
        self.assertEqual(self.api('PATCH', f'{url}/{foreign.id}', {'name': 'x'}).status_code, 422)

    def test_patch_milestone_of_unreadable_project_is_422_not_403(self):
        """A milestone belonging to a private project the caller can't read must not
        leak `milestone_visibility_rule`'s AccessError as a 403 - the contract for an
        invalid milestone_id is 422, not 403 (existence oracle aside)."""
        private = self.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})
        foreign = self.env['project.milestone'].create({'name': 'Confidential', 'project_id': private.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}/milestones/{foreign.id}', {'name': 'x'})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['field'], 'milestone_id')

    def test_checklist_round_trip_does_not_change_task_or_reach_metrics(self):
        project = self._dated_project()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        url = f'/api/v1/projects/{project.id}/milestones'
        res = self.api('POST', url, {
            'name': 'Requirements',
            'start_date': '2026-10-05',
            'deadline': '2026-10-20',
            'deliverables': [{'name': 'Requirements', 'done': False}],
        })
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(body['start_date'], '2026-10-05')
        self.assertEqual(body['deliverables'], [{'name': 'Requirements', 'done': False}])
        milestone = self.env['project.milestone'].browse(body['id'])
        self.env['project.task'].create({
            'name': 'Requirements task', 'project_id': project.id,
            'milestone_id': milestone.id,
        })
        before = next(item for item in self.api('GET', url).json() if item['id'] == milestone.id)
        self.assertEqual((before['task_count'], before['done_task_count'], before['is_reached']), (1, 0, False))

        res = self.api('PATCH', f'{url}/{milestone.id}', {
            'deliverables': [{'name': 'Requirements', 'done': True}],
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['deliverables'], [{'name': 'Requirements', 'done': True}])
        self.assertEqual(
            (res.json()['task_count'], res.json()['done_task_count'], res.json()['is_reached']),
            (1, 0, False),
        )

        res = self.api('PATCH', f'{url}/{milestone.id}', {'is_reached': True})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['deliverables'], [{'name': 'Requirements', 'done': True}])
        self.assertEqual((res.json()['task_count'], res.json()['done_task_count']), (1, 0))

    def test_milestone_and_task_dates_obey_parent_bounds(self):
        project = self._dated_project()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        milestones_url = f'/api/v1/projects/{project.id}/milestones'
        milestone = self.api('POST', milestones_url, {
            'name': 'Bounded milestone', 'start_date': '2026-10-05', 'deadline': '2026-10-20',
        }).json()
        task = self.env['project.task'].create({
            'name': 'Bounded task', 'project_id': project.id, 'milestone_id': milestone['id'],
        })
        schedule_url = f'/api/v1/projects/{project.id}/schedule/tasks/{task.id}'
        res = self.api('PATCH', schedule_url, {'start': '2026-10-04', 'end': '2026-10-10'})
        self.assertEqual(res.status_code, 422, res.text)
        res = self.api('PATCH', schedule_url, {'start': '2026-10-05', 'end': '2026-10-10'})
        self.assertEqual(res.status_code, 200, res.text)

        res = self.api('PATCH', f'/api/v1/tasks/{task.id}', {'date_deadline': '2026-10-04T00:00:00Z'})
        self.assertEqual(res.status_code, 422, res.text)
        second = self.api('POST', milestones_url, {
            'name': 'Later milestone', 'start_date': '2026-10-15', 'deadline': '2026-10-25',
        }).json()
        res = self.api('PATCH', f'/api/v1/tasks/{task.id}', {'milestone_id': second['id']})
        self.assertEqual(res.status_code, 422, res.text)

        res = self.api('PATCH', f'{milestones_url}/{milestone["id"]}', {'deadline': '2026-10-09'})
        self.assertEqual(res.status_code, 422, res.text)
        res = self.api('PATCH', f'/api/v1/projects/{project.id}', {'date': '2026-10-15'})
        self.assertEqual(res.status_code, 422, res.text)

        archived = self.env['project.task'].create({
            'name': 'Archived bounded task', 'project_id': project.id,
            'milestone_id': milestone['id'], 'date_deadline': '2026-10-12 00:00:00',
            'active': False,
        })
        res = self.api('PATCH', f'{milestones_url}/{milestone["id"]}', {'deadline': '2026-10-11'})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertFalse(archived.active)

    def test_task_cannot_be_assigned_to_a_milestone_from_another_company(self):
        project = self._dated_project()
        company_b = self.env['res.company'].create({'name': 'Second milestone company'})
        other_project = self.env['project.project'].create({
            'name': 'Other company project', 'company_id': company_b.id,
            'date_start': date(2026, 10, 1), 'date': date(2026, 10, 31),
        })
        foreign = self.env['project.milestone'].create({'name': 'Foreign milestone', 'project_id': other_project.id})
        task = self.env['project.task'].create({'name': 'Local task', 'project_id': project.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{task.id}', {'milestone_id': foreign.id})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['field'], 'milestone_id')
