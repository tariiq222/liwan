# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestAccessChangeNotification(TransactionCase):

    def setUp(self):
        super().setUp()
        self.service = self.env['webvue.access.service']
        self.target = new_test_user(self.env, login='acc_notify_target', groups='webvue_core.group_employee')
        self.role = self.env['webvue.access.role'].search([('key', '=', 'system_admin')], limit=1)

    def _bell(self, user):
        return self.env['webvue.notify.service'].with_user(user)._webvue_list(50)['items']

    def test_a_role_change_tells_the_user_in_the_bell(self):
        self.assertEqual(self._bell(self.target), [])
        self.service._webvue_access_changed(self.target)
        items = self._bell(self.target)
        self.assertEqual([item['kind'] for item in items], ['access_changed'])
        self.assertTrue(items[0]['title'])
        self.assertFalse(items[0]['is_read'])

    def test_the_actor_is_not_told_about_their_own_change(self):
        self.service.with_user(self.target)._webvue_access_changed(self.target)
        self.assertEqual(self._bell(self.target), [])

    def test_the_row_is_private_to_its_user(self):
        other = new_test_user(self.env, login='acc_notify_other', groups='webvue_core.group_employee')
        self.service._webvue_access_changed(self.target)
        self.assertEqual(self._bell(other), [])

    def test_only_a_later_role_change_rings_not_the_first_grant(self):
        employee = self.env.ref('webvue_core.role_employee')
        company = self.env.company
        self.service._webvue_replace_assignments(self.target, [{'role_id': employee.id, 'company_id': company.id}])
        self.assertEqual(self._bell(self.target), [])
        other = self.env['webvue.access.role'].create({
            'name_ar': 'دور تنبيه', 'type': 'custom', 'company_id': company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([('key', '=', 'access.roles.read')]).ids)],
        })
        self.service._webvue_replace_assignments(self.target, [{'role_id': other.id, 'company_id': company.id}])
        self.assertEqual([item['kind'] for item in self._bell(self.target)], ['access_changed'])
