# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""MTG-84/MTG-163: a meeting's project link is validated before it reaches the database.

An unknown project answers the same not-found as any missing record, another company's project a
422 naming the field, and clearing the link stays open, instead of the raw foreign-key error the
unchecked values produced.
"""
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase

MISSING_PROJECT = 999999


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingProjectCheck(LiwanPmoCase):
    """A meeting or a series links only to a project the caller may read in their current company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        permissions = cls.env['liwan.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create', 'meetings.manage', 'pmo.projects.read']),
        ])
        role = cls.env['liwan.access.role'].create({
            'name_ar': 'ربط الاجتماعات بمشروع', 'key': 'meetings_project_check',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        for user in (cls.employee, cls.manager):
            cls.env['liwan.access.assignment'].create({
                'user_id': user.id, 'company_id': cls.env.company.id, 'role_id': role.id,
            })
        # The employee takes part in both companies, so only the project's company separates them.
        cls.other_company = cls.env['res.company'].create({'name': 'Project Other Co'})
        cls.employee.company_ids = [(4, cls.other_company.id)]
        cls.other_project = cls.env['project.project'].create({
            'name': 'Other company project', 'company_id': cls.other_company.id,
        })
        cls.secret_project = cls.env['project.project'].create({
            'name': 'Private project', 'company_id': cls.env.company.id, 'privacy_visibility': 'followers',
        })

    def setUp(self):
        super().setUp()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _assert_not_found(self, response):
        # The same not-found contract as any missing record: nothing about the project itself leaks.
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), response.text)
        self.assertIn('does not exist', response.json()['message'].lower())
        self.assertNotIn('select', response.text.lower())

    def _assert_invalid(self, response, project_id):
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
        self.assertEqual(response.json()['field'], 'project_id', project_id)

    def _assert_hidden(self, response):
        # A project hidden from this caller is refused; the wording never names it.
        self.assertIn(response.status_code, {403, 404}, response.text)
        self.assertNotIn('select', response.text.lower())
        self.assertNotIn(str(self.secret_project.id), response.text)

    def test_create_with_an_unknown_project_answers_not_found(self):
        response = self.api('POST', '/api/v1/meetings', {'name': 'Ghost project', 'project_id': MISSING_PROJECT})
        self._assert_not_found(response)
        self.assertFalse(self.env['liwan.meeting.minute'].search([('name', '=', 'Ghost project')]))

    def test_patch_with_an_unknown_project_answers_not_found_and_keeps_the_link(self):
        meeting = self.env['liwan.meeting.minute'].create({
            'name': 'Keeps its project', 'organizer_id': self.employee.id, 'project_id': self.project.id,
        })
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'project_id': MISSING_PROJECT})
        self._assert_not_found(response)
        self.assertEqual(meeting.project_id, self.project)

    def test_another_company_project_is_invalid(self):
        foreign = self.api('POST', '/api/v1/meetings', {'name': 'Foreign', 'project_id': self.other_project.id})
        self.assertIn(foreign.status_code, {404, 422}, foreign.text)
        self.assertEqual((foreign.status_code != 404) or foreign.json()['field'], 'project_id')
        meeting = self.env['liwan.meeting.minute'].create({'name': 'Own project', 'organizer_id': self.employee.id})
        patched = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'project_id': self.other_project.id})
        self.assertIn(patched.status_code, {404, 422}, patched.text)
        self.assertFalse(meeting.project_id)

    def test_a_project_the_caller_cannot_read_is_refused(self):
        # A followers-only project the employee does not follow is hidden by the record rules.
        self._assert_hidden(
            self.api('POST', '/api/v1/meetings', {'name': 'Hidden', 'project_id': self.secret_project.id}),
        )

    def test_a_visible_project_links_and_clearing_it_stays_open(self):
        created = self.api('POST', '/api/v1/meetings', {'name': 'Linked', 'project_id': self.project.id})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['project_id'], self.project.id)
        meeting_id = created.json()['id']
        self.assertEqual(self.env['liwan.meeting.minute'].browse(meeting_id).project_id, self.project)
        moved = self.api('PATCH', f'/api/v1/meetings/{meeting_id}', {'project_id': None})
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertIsNone(moved.json()['project_id'])
        self.assertFalse(self.env['liwan.meeting.minute'].browse(meeting_id).project_id)

    def test_a_series_checks_its_project_too(self):
        self._assert_not_found(self.api('POST', '/api/v1/meeting-series', {'name': 'Ghost', 'project_id': MISSING_PROJECT}))
        self._assert_hidden(
            self.api('POST', '/api/v1/meeting-series', {'name': 'Foreign', 'project_id': self.other_project.id}),
        )
        created = self.api('POST', '/api/v1/meeting-series', {'name': 'Linked series', 'project_id': self.project.id})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['project']['id'], self.project.id)


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingProjectCheckWithoutPmoRead(LiwanPmoCase):
    """Meetings without pmo.projects.read keep a 422 instead of the identifier."""

    def test_a_caller_without_the_projects_capability_is_refused(self):
        user = new_test_user(self.env, login='api_meet_only', password='api_meet_only_pass_123', groups='liwan_core.group_employee')
        permissions = self.env['liwan.access.permission'].search([('key', 'in', ['meetings.read', 'meetings.create'])])
        role = self.env['liwan.access.role'].create({
            'name_ar': 'اجتماعات بلا مشاريع', 'key': 'meetings_without_projects_read',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': self.env.company.id, 'role_id': role.id})
        self.authenticate('api_meet_only', 'api_meet_only_pass_123')
        refused = self.api('POST', '/api/v1/meetings', {'name': 'Linked', 'project_id': self.project.id})
        self.assertEqual(refused.status_code, 403, refused.text)
