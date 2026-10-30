# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from odoo.tests import tagged

from .common import LiwanMeetingsCase

UNSUPPORTED = 'project_id is not supported: the projects application is not installed'


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingsWithoutProjects(LiwanMeetingsCase):
    """liwan_meetings without the projects bridge keeps every payload shape and refuses project links (ruling H.1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        bridge = cls.env['ir.module.module'].search([('name', '=', 'liwan_meetings_pmo'), ('state', '=', 'installed')])
        if bridge:
            reason = 'the meetings/projects bridge is installed'
            raise unittest.SkipTest(reason)
        role = cls.env['liwan.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات بلا مشاريع', 'key': 'meetings_without_projects',
            'type': 'custom', 'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.employee.id, 'company_id': cls.env.company.id, 'role_id': role.id,
        })
        cls.series = cls.env['liwan.meeting.series'].create({
            'name': 'No project cadence', 'recurrence': 'none', 'organizer_id': cls.employee.id,
        })
        cls.meeting = cls.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'No project meeting', 'organizer_id': cls.employee.id,
            'series_id': cls.series.id, 'meeting_date': '2026-09-10',
        })
        cls.resolution = cls.env['liwan.meeting.resolution'].create({
            'meeting_id': cls.meeting.id, 'name': 'No project recommendation',
            'responsible_id': cls.employee.id, 'deadline': '2026-09-30',
        })

    def setUp(self):
        super().setUp()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _assert_unsupported(self, response):
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json(), {'code': 'invalid', 'message': UNSUPPORTED, 'field': 'project_id'})

    def test_no_model_carries_a_project_link(self):
        self.assertEqual(self.env['liwan.meeting.links']._liwan_link_fields(), frozenset())
        for model in ('liwan.meeting.minute', 'liwan.meeting.resolution', 'liwan.meeting.series'):
            self.assertNotIn('project_id', self.env[model]._fields, model)

    def test_payloads_keep_their_project_keys_as_null(self):
        detail = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        body = detail.json()
        self.assertIsNone(body['project_id'])
        self.assertIsNone(body['project'])
        row = next(item for item in body['resolutions'] if item['id'] == self.resolution.id)
        self.assertIsNone(row['project'])
        self.assertIsNone(row['task_id'])
        self.assertFalse(row['task_linked'])
        series = self.api('GET', f'/api/v1/meeting-series/{self.series.id}')
        self.assertEqual(series.status_code, 200, series.text)
        self.assertIsNone(series.json()['project'])

    def test_the_project_filter_is_validated_and_ignored(self):
        listed = self.api('GET', '/api/v1/meetings?project_id=987654&date_from=2026-09-10&date_to=2026-09-10')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(self.meeting.id, [item['id'] for item in listed.json()['items']])
        series = self.api('GET', '/api/v1/meeting-series?project_id=987654&q=No%20project')
        self.assertEqual(series.status_code, 200, series.text)
        self.assertIn(self.series.id, [item['id'] for item in series.json()['items']])
        invalid = self.api('GET', '/api/v1/meetings?project_id=abc')
        self.assertEqual(invalid.status_code, 422, invalid.text)
        self.assertEqual(invalid.json()['field'], 'project_id')

    def test_project_links_are_refused_and_clearing_is_a_no_op(self):
        self._assert_unsupported(self.api('POST', '/api/v1/meetings', {'name': 'With project', 'project_id': 5}))
        self._assert_unsupported(self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'project_id': 5}))
        self._assert_unsupported(self.api('POST', f'/api/v1/meetings/{self.meeting.id}/resolutions', {
            'name': 'With project', 'responsible_id': self.employee.id, 'deadline': '2026-09-30', 'project_id': 5,
        }))
        self._assert_unsupported(self.api(
            'PATCH', f'/api/v1/meetings/{self.meeting.id}/resolutions/{self.resolution.id}', {'project_id': 5},
        ))
        self._assert_unsupported(self.api('POST', '/api/v1/meeting-series', {'name': 'With project', 'project_id': 5}))
        cleared = self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'name': 'Renamed', 'project_id': None})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()['name'], 'Renamed')
        form = {
            'opening': '', 'closing': '', 'chairperson': '', 'approver_name': '', 'approver_title': '',
            'topics': [{'key': 'p', 'title': 'Project topic', 'discussion': '', 'project_id': 5, 'resolution_ids': []}],
        }
        topic = self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'minutes_form': form})
        self.assertEqual(topic.status_code, 422, topic.text)
        self.assertEqual(topic.json()['code'], 'invalid')

    def test_conversion_is_not_served(self):
        response = self.api(
            'POST', f'/api/v1/meetings/{self.meeting.id}/resolutions/{self.resolution.id}/convert', {'project_id': 5},
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()['code'], 'not_found')
