# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestBranchManagerFollowers(TransactionCase):
    """A meeting manager who also works in a branch must not break other managers' meeting writes (#226).

    The follower allow-list walks every meeting manager; the organizer cannot read the branches of a
    manager who works in one, so the list relies on the company-scoped capability, not on the
    manager's company records.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Meetings follower branch', 'parent_id': cls.parent.id})
        role = cls.env['webvue.access.role'].create({
            'key': 'meeting_follower_manager', 'type': 'built_in', 'name_ar': 'مدير اجتماعات',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create', 'meetings.manage']),
            ]).ids)],
        })
        cls.organizer = new_test_user(
            cls.env, login='meeting_parent_organizer', groups='base.group_user',
            company_id=cls.parent.id, company_ids=[Command.set(cls.parent.ids)],
        )
        cls.branch_manager = new_test_user(
            cls.env, login='meeting_branch_manager', groups='base.group_user',
            company_id=cls.parent.id, company_ids=[Command.set((cls.parent | cls.branch).ids)],
        )
        cls.branch_only_manager = new_test_user(
            cls.env, login='meeting_branch_only_manager', groups='base.group_user',
            company_id=cls.branch.id, company_ids=[Command.set(cls.branch.ids)],
        )
        cls.env['webvue.access.assignment'].create([
            {'user_id': cls.organizer.id, 'role_id': role.id, 'company_id': cls.parent.id},
            {'user_id': cls.branch_manager.id, 'role_id': role.id, 'company_id': cls.parent.id},
            {'user_id': cls.branch_manager.id, 'role_id': role.id, 'company_id': cls.branch.id},
            {'user_id': cls.branch_only_manager.id, 'role_id': role.id, 'company_id': cls.branch.id},
        ])

    def _create_as_organizer(self):
        return self.env['webvue.meeting.minute'].with_user(self.organizer).with_company(self.parent).create({
            'name': 'Parent meeting', 'company_id': self.parent.id, 'meeting_date': fields.Date.today(),
        })

    def test_organizer_creates_and_edits_with_a_branch_manager_present(self):
        meeting = self._create_as_organizer()
        meeting.write({'name': 'Parent meeting renamed'})
        self.assertEqual(meeting.name, 'Parent meeting renamed')

    def test_allow_list_keeps_managers_of_the_meeting_company_only(self):
        meeting = self._create_as_organizer()
        allowed = meeting._webvue_allowed_follower_partners()
        self.assertIn(self.branch_manager.partner_id, allowed)
        self.assertNotIn(self.branch_only_manager.partner_id, allowed)
