# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestMeetingBranchPermissions(WebVueApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Meetings delegated branch', 'parent_id': cls.parent.id})
        cls.member_branch = cls.env['res.company'].create({'name': 'Meetings member only', 'parent_id': cls.parent.id})
        cls.foreign = cls.env['res.company'].create({'name': 'Meetings foreign company'})
        cls.actor = new_test_user(
            cls.env, login='meeting_branch_actor', password='meeting_branch_password', groups='base.group_user',
            company_id=cls.parent.id, company_ids=[Command.set((cls.parent | cls.branch | cls.member_branch | cls.foreign).ids)],
        )
        cls.organizer = new_test_user(
            cls.env, login='meeting_branch_organizer', groups='base.group_user',
            company_id=cls.branch.id, company_ids=[Command.set((cls.parent | cls.branch | cls.member_branch | cls.foreign).ids)],
        )
        permissions = cls.env['webvue.access.permission'].search([('key', 'in', ['meetings.read', 'meetings.create', 'meetings.manage'])])
        cls.reader, cls.manager_role = cls.env['webvue.access.role'].create([
            {'key': 'meeting_branch_read', 'type': 'built_in', 'name_ar': 'قارئ اجتماعات',
             'permission_ids': [Command.set(permissions.filtered(lambda permission: permission.key == 'meetings.read').ids)]},
            {'key': 'meeting_branch_manage', 'type': 'built_in', 'name_ar': 'مدير اجتماعات',
             'permission_ids': [Command.set(permissions.ids)]},
        ])
        cls.env['webvue.access.assignment'].create([
            {'user_id': cls.actor.id, 'role_id': cls.manager_role.id, 'company_id': cls.parent.id},
            {'user_id': cls.actor.id, 'role_id': cls.reader.id, 'company_id': cls.branch.id},
            {'user_id': cls.organizer.id, 'role_id': cls.manager_role.id, 'company_id': cls.branch.id},
        ])
        cls.records = {}
        for company in (cls.parent, cls.branch, cls.member_branch, cls.foreign):
            series = cls.env['webvue.meeting.series'].create({
                'name': f'Private series {company.id}', 'company_id': company.id,
                'organizer_id': cls.organizer.id,
            })
            meeting = cls.env['webvue.meeting.minute'].with_company(company).create({
                'name': f'Private minute {company.id}', 'company_id': company.id,
                'organizer_id': cls.organizer.id, 'series_id': series.id,
                'meeting_date': fields.Date.today(), 'minutes': '<p>Private owning company transcript</p>',
            })
            resolution = cls.env['webvue.meeting.resolution'].with_company(company).create({
                'meeting_id': meeting.id, 'name': 'Private decision', 'responsible_id': cls.organizer.id,
                'deadline': fields.Date.today(),
            })
            cls.records[company.id] = (meeting, series, resolution)

    def login(self):
        self.authenticate('meeting_branch_actor', 'meeting_branch_password')

    def scoped(self, record):
        return record.with_user(self.actor).with_context(
            allowed_company_ids=[self.parent.id, self.branch.id, self.member_branch.id, self.foreign.id],
            webvue_capability_scope=((('meetings.read',), 'all'),),
        )

    def test_parent_manager_cannot_read_private_branch_or_member_only_payloads(self):
        self.login()
        for company in (self.branch, self.member_branch, self.foreign):
            meeting, series, resolution = self.records[company.id]
            for path in (f'/api/v1/meetings/{meeting.id}', f'/api/v1/meeting-series/{series.id}',
                         f'/api/v1/meeting-series/{series.id}/resolutions'):
                result = self.api('GET', path)
                self.assertEqual(result.status_code, 403 if company == self.branch else 404, result.text)
                self.assertNotIn('Private owning company transcript', result.text)
            for record in (meeting, series, resolution):
                scoped = self.scoped(record)
                self.assertFalse(scoped.search([('id', '=', record.id)]))
                with self.assertRaises(AccessError):
                    scoped.read(['name'])
        parent_meeting = self.records[self.parent.id][0]
        self.assertEqual(self.api('GET', f'/api/v1/meetings/{parent_meeting.id}').status_code, 200)

    def test_parent_manager_cannot_mutate_private_branch_records(self):
        self.login()
        meeting, series, resolution = self.records[self.branch.id]
        for method, path, payload in (
            ('PATCH', f'/api/v1/meetings/{meeting.id}', {'name': 'Borrowed parent edit'}),
            ('POST', f'/api/v1/meetings/{meeting.id}/cancel', {}),
            ('PATCH', f'/api/v1/meeting-series/{series.id}', {'name': 'Borrowed parent edit'}),
            ('PATCH', f'/api/v1/meetings/{meeting.id}/resolutions/{resolution.id}', {'name': 'Borrowed parent edit'}),
        ):
            result = self.api(method, path, payload)
            self.assertEqual(result.status_code, 403, result.text)
        for record in (meeting, series, resolution):
            with self.assertRaises(AccessError):
                self.scoped(record).write({'name': 'Borrowed parent ORM edit'})

    def test_branch_attendee_has_no_parent_manager_flags_or_mutations(self):
        meeting, series, resolution = self.records[self.branch.id]
        meeting.write({'attendee_ids': [Command.link(self.actor.id)]})
        series.write({'attendee_ids': [Command.link(self.actor.id)]})
        self.login()
        detail = self.api('GET', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertFalse(self.scoped(meeting).can_manage)
        self.assertFalse(self.scoped(meeting).can_edit)
        self.assertFalse(self.scoped(resolution).can_edit_decision)
        self.assertFalse(self.scoped(resolution).can_update_execution)
        workspace = self.api('GET', '/api/v1/meetings/resolutions')
        self.assertEqual(workspace.status_code, 200, workspace.text)
        rows = {row['id']: row for row in workspace.json()['items']}
        self.assertEqual(rows[resolution.id]['allowed_actions'], [])
        self.assertIn('cancel', rows[self.records[self.parent.id][2].id]['allowed_actions'])
        for method, path, payload in (
            ('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes': '<p>Denied</p>'}),
            ('POST', f'/api/v1/meetings/{meeting.id}/cancel', {}),
            ('PATCH', f'/api/v1/meeting-series/{series.id}', {'name': 'Denied'}),
            ('PATCH', f'/api/v1/meetings/{meeting.id}/resolutions/{resolution.id}', {'name': 'Denied'}),
        ):
            result = self.api(method, path, payload)
            self.assertEqual(result.status_code, 403, result.text)

    def test_branch_secretary_keeps_contextual_edits_without_manager_transitions(self):
        meeting, _series, resolution = self.records[self.branch.id]
        meeting.write({'secretary_id': self.actor.id})
        self.login()
        result = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes': '<p>Secretary update</p>'})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(self.scoped(meeting).can_edit)
        self.assertFalse(self.scoped(meeting).can_manage)
        self.scoped(resolution).write({'name': 'Secretary decision'})
        self.assertTrue(self.scoped(resolution).can_edit_decision)
        denied = self.api('POST', f'/api/v1/meetings/{meeting.id}/cancel', {})
        self.assertEqual(denied.status_code, 403, denied.text)

    def test_branch_assignee_keeps_execution_without_editing_decisions(self):
        meeting, _series, resolution = self.records[self.branch.id]
        meeting.write({'attendee_ids': [Command.link(self.actor.id)]})
        resolution.write({'responsible_id': self.actor.id})
        scoped = self.scoped(resolution)
        self.assertTrue(scoped.can_update_execution)
        self.assertFalse(scoped.can_edit_decision)
        scoped.write({'state': 'in_progress'})
        with self.assertRaises(AccessError):
            scoped.write({'name': 'Assignee cannot edit decisions'})

    def test_parent_create_capability_cannot_create_a_minute_in_read_only_branch(self):
        Meeting = self.scoped(self.env['webvue.meeting.minute'])
        with self.assertRaises(AccessError):
            Meeting.create({'name': 'Borrowed branch creation', 'company_id': self.branch.id})

    def test_selected_branch_keeps_its_own_root_under_an_isolated_parent(self):
        self.parent.write({'webvue_branch_access_mode': 'isolated'})
        meeting, series, _resolution = self.records[self.branch.id]
        meeting.write({'attendee_ids': [Command.link(self.actor.id)]})
        branch_meeting = meeting.with_user(self.actor).with_context(allowed_company_ids=[self.branch.id])
        self.assertEqual(branch_meeting.read(['name'])[0]['name'], meeting.name)
        self.assertFalse(branch_meeting.can_manage)
        branch_series = series.with_env(branch_meeting.env)
        self.assertEqual(branch_series.read(['name'])[0]['name'], series.name)
        self.assertFalse(self.scoped(meeting).has_access('read'))

    def test_warm_private_visibility_is_revoked_with_the_actual_branch_manager_grant(self):
        assignment = self.env['webvue.access.assignment'].create({
            'user_id': self.actor.id, 'role_id': self.manager_role.id, 'company_id': self.branch.id,
        })
        meeting = self.scoped(self.records[self.branch.id][0])
        self.assertTrue(meeting.read(['name']))
        assignment.unlink()
        self.assertFalse(meeting.search([('id', '=', meeting.id)]))
        with self.assertRaises(AccessError):
            meeting.read(['name'])

    def test_actual_branch_manager_keeps_private_read_and_mutation(self):
        self.env['webvue.access.assignment'].create({
            'user_id': self.actor.id, 'role_id': self.manager_role.id, 'company_id': self.branch.id,
        })
        meeting, series, resolution = self.records[self.branch.id]
        self.login()
        for method, path, payload in (
            ('GET', f'/api/v1/meetings/{meeting.id}', None),
            ('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes': '<p>Branch manager update</p>'}),
            ('PATCH', f'/api/v1/meeting-series/{series.id}', {'name': 'Branch manager series'}),
            ('PATCH', f'/api/v1/meetings/{meeting.id}/resolutions/{resolution.id}', {'name': 'Branch manager decision'}),
            ('POST', f'/api/v1/meetings/{meeting.id}/cancel', {}),
        ):
            result = self.api(method, path, payload)
            self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(self.scoped(meeting).can_manage)
