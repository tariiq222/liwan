# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields
from odoo.tests import new_test_user, tagged

from .meetings_common import NasqMeetingsCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestMeetingPermissions(NasqMeetingsCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_a = cls.env.company
        cls.company_b = cls.env['res.company'].create({
            'name': 'Meeting permissions B',
            'nasq_access_policy_version': 1,
        })
        cls.users = {}
        for key, login in {
            'none': 'meeting_permissions_none',
            'reader': 'meeting_permissions_reader',
            'creator': 'meeting_permissions_creator',
            'secretary': 'meeting_permissions_secretary',
            'manager': 'meeting_permissions_manager',
            'scoped_manager': 'meeting_permissions_scoped_manager',
        }.items():
            cls.users[key] = new_test_user(
                cls.env,
                login=login,
                password='meeting_permissions_pass_123',
                groups='base.group_user',
                company_id=cls.company_a.id,
                company_ids=[cls.company_a.id, cls.company_b.id],
            )

        Permission = cls.env['nasq.access.permission']

        def role(key, permission_keys, company):
            return cls.env['nasq.access.role'].with_company(company).create({
                'key': f'meeting_permissions_{key}',
                'name_ar': f'صلاحية اجتماعات {key}',
                'name_en': f'Meeting permissions {key}',
                'company_id': company.id,
                'permission_ids': [(6, 0, Permission.search([
                    ('key', 'in', permission_keys),
                ]).ids)],
            })

        roles = {
            'read': role('read', ['meetings.read'], cls.company_a),
            'create': role('create', ['meetings.read', 'meetings.create'], cls.company_a),
            'manage': role('manage', ['meetings.read', 'meetings.manage'], cls.company_a),
        }
        Assignment = cls.env['nasq.access.assignment']

        def assign(user_key, role_key, company=cls.company_a):
            return Assignment.create({
                'user_id': cls.users[user_key].id,
                'role_id': roles[role_key].id,
                'company_id': company.id,
            })

        cls.assignments = {
            'reader': assign('reader', 'read'),
            'creator': assign('creator', 'create'),
            'secretary': assign('secretary', 'create'),
            'manager': assign('manager', 'manage'),
            'scoped_manager': assign('scoped_manager', 'manage'),
        }
        cls.users['scoped_manager'].write({'company_id': cls.company_b.id})

        cls.series = cls.env['nasq.meeting.series'].with_company(cls.company_a).create({
            'name': 'Permission series',
            'company_id': cls.company_a.id,
            'organizer_id': cls.users['manager'].id,
            'secretary_id': cls.users['secretary'].id,
            'attendee_ids': [(6, 0, [
                cls.users['reader'].id,
                cls.users['creator'].id,
            ])],
        })
        cls.meeting = cls.env['cyan.meeting.minute'].with_company(cls.company_a).create({
            'name': 'Permission meeting',
            'state': 'draft',
            'company_id': cls.company_a.id,
            'organizer_id': cls.users['manager'].id,
            'attendee_ids': [(6, 0, [
                cls.users['reader'].id,
                cls.users['creator'].id,
            ])],
            'meeting_date': date.today(),
        })

    def _authenticate(self, user_key):
        self.authenticate(
            self.users[user_key].login,
            'meeting_permissions_pass_123',
        )

    def test_capability_catalog_labels_and_dependencies_cover_series_scope(self):
        Permission = self.env['nasq.access.permission']
        read = Permission.search([('key', '=', 'meetings.read')])
        create = Permission.search([('key', '=', 'meetings.create')])
        manage = Permission.search([('key', '=', 'meetings.manage')])
        self.assertIn('السلاسل', read.name_ar)
        self.assertIn('series', read.name_en.lower())
        self.assertIn('الشركة الحالية', read.description_ar)
        self.assertIn('current company', read.description_en.lower())
        self.assertEqual(create.dependency_ids.mapped('key'), ['meetings.read'])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['meetings.read'])
        self.assertNotIn('meetings.create', manage.dependency_ids.mapped('key'))

    def test_http_user_without_meeting_grant_is_denied_list_detail_and_create(self):
        self._authenticate('none')
        listed = self.api('GET', '/api/v1/meetings')
        detailed = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        created = self.api('POST', '/api/v1/meetings', {
            'name': 'Denied meeting', 'meeting_date': fields.Date.to_string(fields.Date.today()),
        })
        self.assertEqual(listed.status_code, 403, listed.text)
        self.assertEqual(detailed.status_code, 403, detailed.text)
        self.assertEqual(created.status_code, 403, created.text)

    def test_http_reader_participant_can_read_but_cannot_create(self):
        self._authenticate('reader')
        listed = self.api('GET', '/api/v1/meetings')
        detailed = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        created = self.api('POST', '/api/v1/meetings', {
            'name': 'Reader cannot create', 'meeting_date': fields.Date.to_string(fields.Date.today()),
        })
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(self.meeting.id, [row['id'] for row in listed.json()['items']])
        self.assertEqual(detailed.status_code, 200, detailed.text)
        self.assertEqual(created.status_code, 403, created.text)

    def test_http_creator_participant_cannot_add_to_another_users_series(self):
        self._authenticate('creator')
        direct = self.api('POST', f'/api/v1/meeting-series/{self.series.id}/occurrences', {
            'name': 'Creator occurrence',
        })
        linked = self.api('POST', '/api/v1/meetings', {
            'name': 'Creator linked meeting',
            'meeting_date': fields.Date.to_string(fields.Date.today()),
            'series_id': self.series.id,
        })
        self.assertEqual(direct.status_code, 403, direct.text)
        self.assertEqual(linked.status_code, 403, linked.text)

    def test_http_secretary_with_create_can_add_to_series(self):
        self._authenticate('secretary')
        response = self.api('POST', f'/api/v1/meeting-series/{self.series.id}/occurrences', {
            'name': 'Secretary occurrence',
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['series_id'], self.series.id)

    def test_http_manager_without_create_can_read_but_cannot_create_or_add(self):
        self._authenticate('manager')
        listed = self.api('GET', '/api/v1/meetings')
        meeting = self.api('POST', '/api/v1/meetings', {
            'name': 'Manager cannot create', 'meeting_date': fields.Date.to_string(fields.Date.today()),
        })
        series = self.api('POST', '/api/v1/meeting-series', {
            'name': 'Manager cannot create series', 'recurrence': 'none',
        })
        occurrence = self.api('POST', f'/api/v1/meeting-series/{self.series.id}/occurrences', {
            'name': 'Manager cannot add',
        })
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(meeting.status_code, 403, meeting.text)
        self.assertEqual(series.status_code, 403, series.text)
        self.assertEqual(occurrence.status_code, 403, occurrence.text)

    def test_http_company_assignment_is_not_inherited_when_current_company_changes(self):
        self._authenticate('scoped_manager')
        listed = self.api('GET', '/api/v1/meetings')
        detailed = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        self.assertEqual(listed.status_code, 403, listed.text)
        self.assertEqual(detailed.status_code, 403, detailed.text)

    def test_http_revoked_reader_grant_is_denied_on_next_list_and_detail(self):
        self._authenticate('reader')
        self.assertEqual(self.api('GET', '/api/v1/meetings').status_code, 200)
        self.assertEqual(self.api('GET', f'/api/v1/meetings/{self.meeting.id}').status_code, 200)
        self.assignments['reader'].unlink()
        self._authenticate('reader')
        listed = self.api('GET', '/api/v1/meetings')
        detailed = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        self.assertEqual(listed.status_code, 403, listed.text)
        self.assertEqual(detailed.status_code, 403, detailed.text)
