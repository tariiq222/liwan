# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('webvue', 'webvue_access')
class TestWebVueMeetingCompanyAccess(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_a = cls.env.company
        cls.company_b = cls.env['res.company'].create({'name': 'Meeting scope B'})
        cls.user = new_test_user(cls.env, login='meeting_scope_user', groups='base.group_user',
                                company_id=cls.company_a.id, company_ids=(cls.company_a | cls.company_b).ids)
        cls.owner = new_test_user(cls.env, login='meeting_scope_owner', groups='base.group_user',
                                 company_id=cls.company_b.id, company_ids=(cls.company_a | cls.company_b).ids)
        Permission = cls.env['webvue.access.permission']
        for company, keys in [(cls.company_a, ['meetings.read', 'meetings.create', 'meetings.manage']),
                              (cls.company_b, ['meetings.read'])]:
            role = cls.env['webvue.access.role'].with_company(company).create({'name_ar': 'اختبار الشركة', 'company_id': company.id,
                'permission_ids': [(6, 0, Permission.search([('key', 'in', keys)]).ids)]})
            cls.env['webvue.access.assignment'].create({'user_id': cls.user.id, 'role_id': role.id, 'company_id': company.id})
        cls.meeting = cls.env['webvue.meeting.minute'].with_company(cls.company_b).create({
            'name': 'Private B', 'company_id': cls.company_b.id, 'organizer_id': cls.owner.id, 'state': 'draft'})
        cls.resolution = cls.env['webvue.meeting.resolution'].create({'meeting_id': cls.meeting.id,
            'name': 'Private decision', 'responsible_id': cls.owner.id, 'deadline': '2026-09-10'})

    def test_manager_in_a_is_not_manager_or_reader_of_unrelated_b(self):
        Meeting = self.meeting.with_user(self.user).with_company(self.company_b)
        self.assertFalse(Meeting._webvue_is_manager())
        self.assertFalse(Meeting.search([('id', '=', self.meeting.id)]))
        with self.assertRaises(AccessError):
            Meeting.read(['name'])
        with self.assertRaises(AccessError):
            Meeting.write({'name': 'Illicit'})
        resolution = self.resolution.with_user(self.user).with_company(self.company_b)
        self.assertFalse(resolution.search([('id', '=', self.resolution.id)]))
        with self.assertRaises(AccessError):
            resolution.read(['name'])

    def test_read_capability_does_not_grant_direct_create(self):
        with self.assertRaises(AccessError):
            self.env['webvue.meeting.minute'].with_user(self.user).with_company(self.company_b).create({'name': 'Illicit'})

    def test_b_participant_can_read_but_cannot_edit_or_manage(self):
        self.meeting.write({'attendee_ids': [(4, self.user.id)]})
        meeting = self.meeting.with_user(self.user).with_company(self.company_b)
        self.assertEqual(meeting.read(['name'])[0]['name'], 'Private B')
        self.assertFalse(meeting.can_edit)
        with self.assertRaises(AccessError):
            meeting.write({'name': 'Illicit'})

    def test_attachment_target_access_uses_company_scoped_meeting_rule(self):
        attachment = self.env['ir.attachment'].create({'name': 'private.txt', 'raw': b'private',
            'res_model': 'webvue.meeting.minute', 'res_id': self.meeting.id, 'type': 'binary'})
        with self.assertRaises(AccessError):
            attachment.with_user(self.user).with_company(self.company_b).read(['raw'])
