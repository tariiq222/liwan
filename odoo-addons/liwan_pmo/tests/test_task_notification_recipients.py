# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestTaskNotificationRecipients(TransactionCase):
    """A recipient is a member of the company the request acts in, wherever the person is homed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = cls.env.company
        cls.branch_a = cls.env['res.company'].create({'name': 'Recipients branch A', 'parent_id': root.id})
        cls.branch_b = cls.env['res.company'].create({'name': 'Recipients branch B', 'parent_id': root.id})
        cls.visitor = new_test_user(
            cls.env, login='recipient_visitor', groups='liwan_core.group_employee',
            company_id=cls.branch_a.id, company_ids=[Command.set([cls.branch_a.id, cls.branch_b.id])],
        )
        cls.native = new_test_user(
            cls.env, login='recipient_native', groups='liwan_core.group_employee',
            company_id=cls.branch_b.id, company_ids=[Command.set([cls.branch_b.id])],
        )
        cls.stranger = new_test_user(
            cls.env, login='recipient_stranger', groups='liwan_core.group_employee',
            company_id=cls.branch_a.id, company_ids=[Command.set([cls.branch_a.id])],
        )

    def test_a_member_of_the_request_company_homed_elsewhere_is_kept(self):
        users = self.visitor | self.native | self.stranger
        recipients = self.env['project.task'].with_company(self.branch_b)._liwan_internal_users(users)
        self.assertEqual(recipients, self.visitor | self.native)
