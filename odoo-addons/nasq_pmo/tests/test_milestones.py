# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

KEYS = {'id', 'name', 'deadline', 'is_reached', 'reached_date', 'task_count', 'done_task_count'}


@tagged('post_install', '-at_install', 'nasq')
class TestMilestones(NasqPmoCase):

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
