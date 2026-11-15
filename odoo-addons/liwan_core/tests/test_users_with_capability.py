# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

KEY = 'probe.holders.manage'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestUsersWithCapability(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.other = cls.env['res.company'].create({'name': 'Holders elsewhere'})
        group = cls.env['res.groups'].create({'name': 'Holders probe'})
        cls.env['ir.model.data'].create({
            'module': 'liwan_core', 'name': f'holders_probe_{group.id}', 'model': 'res.groups', 'res_id': group.id,
        })
        permission = cls.env['liwan.access.permission'].create({
            'key': KEY, 'name_ar': KEY, 'name_en': KEY, 'domain': 'probe',
            'group_xmlid': f'liwan_core.holders_probe_{group.id}', 'custom_role_allowed': True,
            'resource': 'holders', 'action': 'manage', 'description_ar': KEY,
        })
        cls.role = cls.env['liwan.access.role'].create({
            'key': 'holders_probe', 'type': 'built_in', 'name_ar': 'holders',
            'permission_ids': [Command.set(permission.ids)],
        })
        cls.service = cls.env['liwan.access.service']

    def _user(self, login, name, *, member=None, holds=None, **values):
        member = member or self.company
        user = new_test_user(
            self.env, login=login, name=name, groups='base.group_user', company_id=member.id,
            company_ids=[Command.set(member.ids)], **values,
        )
        if holds:
            self.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': self.role.id, 'company_id': holds.id,
            })
        return user

    def _holders(self, query=None):
        return self.service._liwan_users_with_capability(self.company, KEY, query)

    def test_returns_the_holders_of_the_company_ordered_by_name_then_id(self):
        zed = self._user('holder_zed', 'Zed holder', holds=self.company)
        amy = self._user('holder_amy', 'Amy holder', holds=self.company)
        twin = self._user('holder_twin', 'Amy holder', holds=self.company)
        self.assertEqual(self._holders(), amy + twin + zed)

    def test_leaves_out_a_member_who_does_not_hold_the_capability(self):
        self._user('plain_member', 'Plain member')
        holder = self._user('real_holder', 'Real holder', holds=self.company)
        self.assertEqual(self._holders(), holder)

    def test_leaves_out_a_member_of_another_company_and_a_holder_there(self):
        self._user('elsewhere_holder', 'Elsewhere holder', member=self.other, holds=self.other)
        self.assertFalse(self._holders())

    def test_leaves_out_a_share_user(self):
        portal = new_test_user(
            self.env, login='holder_portal', name='Portal holder', groups='base.group_portal',
            company_id=self.company.id, company_ids=[Command.set(self.company.ids)],
        )
        self.env['liwan.access.assignment'].create({
            'user_id': portal.id, 'role_id': self.role.id, 'company_id': self.company.id,
        })
        self.assertFalse(self._holders())

    def test_leaves_out_an_archived_user(self):
        user = self._user('holder_archived', 'Archived holder', holds=self.company)
        user.active = False
        self.assertFalse(self._holders())

    def test_filters_by_name_ignoring_case(self):
        amy = self._user('filter_amy', 'Amy Filter', holds=self.company)
        self._user('filter_bob', 'Bob Filter', holds=self.company)
        self.assertEqual(self._holders('aMY'), amy)
        self.assertFalse(self._holders('nobody'))
