# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""An application's own marker in the res.partner write guard: ``_liwan_marked_write_fields``."""
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.protected_write import marked

TEST_MARKER = 'liwan_core.test_partner_extension_ids'
TEST_FIELDS = frozenset({'name', 'phone'})
REFUSED = 'use_protected_liwan_access_operation'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestPartnerWriteExtensions(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(cls.env, login='partner_ext_admin', groups='liwan_core.group_employee')
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.env.company.id,
        }])
        cls.partner = cls.env['res.partner'].create({'name': 'Extension contact'})

    def setUp(self):
        super().setUp()
        self.declare({TEST_MARKER: TEST_FIELDS})

    def declare(self, declared):
        partner_class = type(self.env['res.partner'])
        base = partner_class._liwan_marked_write_fields
        self.patch(partner_class, '_liwan_marked_write_fields', lambda model: {**base(model), **declared})

    def write_as_admin(self, partner, vals):
        partner.with_user(self.admin).write(vals)

    def test_the_actor_is_protected(self):
        self.assertTrue(self.env['liwan.access.service']._liwan_has_capability(self.admin, 'settings.company.manage'))
        self.assertFalse(self.admin.has_group('base.group_system'))

    def test_a_write_inside_an_extension_marker_passes(self):
        with marked(self.env, {TEST_MARKER: self.partner.ids}):
            self.write_as_admin(self.partner, {'name': 'Renamed', 'phone': '+966500000001'})
        self.assertEqual(self.partner.name, 'Renamed')

    def test_the_same_write_without_the_marker_is_refused(self):
        with self.assertRaisesRegex(AccessError, REFUSED):
            self.write_as_admin(self.partner, {'name': 'Renamed'})

    def test_a_field_the_extension_does_not_list_is_refused(self):
        with marked(self.env, {TEST_MARKER: self.partner.ids}), self.assertRaisesRegex(AccessError, REFUSED):
            self.write_as_admin(self.partner, {'email': 'other@example.test'})

    def test_a_partner_outside_the_marker_is_refused(self):
        other = self.env['res.partner'].create({'name': 'Unmarked contact'})
        with marked(self.env, {TEST_MARKER: self.partner.ids}), self.assertRaisesRegex(AccessError, REFUSED):
            self.write_as_admin(self.partner | other, {'phone': '+966500000002'})

    def test_an_extension_marker_never_covers_a_user_partner(self):
        user = new_test_user(self.env, login='partner_ext_user', groups='base.group_user')
        archived = new_test_user(self.env, login='partner_ext_archived', groups='base.group_user')
        archived.active = False
        for partner in (user.partner_id, archived.partner_id):
            with self.subTest(partner=partner.name), marked(self.env, {TEST_MARKER: partner.ids}), \
                    self.assertRaisesRegex(AccessError, REFUSED):
                self.write_as_admin(partner, {'phone': '+966500000003'})

    def test_an_extension_marker_never_covers_an_account_homed_in_a_branch_the_actor_cannot_read(self):
        branch = self.env['res.company'].create({'name': 'Extension branch', 'parent_id': self.env.company.id})
        member = new_test_user(
            self.env, login='partner_ext_branch_member', groups='base.group_user',
            company_id=branch.id, company_ids=[branch.id],
        )
        archived = new_test_user(
            self.env, login='partner_ext_branch_archived', groups='base.group_user',
            company_id=branch.id, company_ids=[branch.id],
        )
        archived.active = False
        # rule_access_users_company hides both accounts from the actor.
        users = self.env['res.users'].with_user(self.admin).with_context(active_test=False)
        self.assertFalse(users.search_count([('id', 'in', (member | archived).ids)]))
        for partner in (member.partner_id, archived.partner_id):
            with self.subTest(partner=partner.name), marked(self.env, {TEST_MARKER: partner.ids}), \
                    self.assertRaisesRegex(AccessError, REFUSED):
                self.write_as_admin(partner, {'phone': '+966500000005'})

    def test_an_extension_marker_never_covers_a_company_partner(self):
        company_partner = self.env.company.partner_id
        with marked(self.env, {TEST_MARKER: company_partner.ids}), self.assertRaisesRegex(AccessError, REFUSED):
            self.write_as_admin(company_partner, {'phone': '+966500000004'})

    def test_an_extension_naming_a_structural_field_fails_loudly(self):
        self.declare({TEST_MARKER: TEST_FIELDS | {'user_ids'}})
        with marked(self.env, {TEST_MARKER: self.partner.ids}), self.assertRaises(ValueError):
            self.write_as_admin(self.partner, {'name': 'Renamed'})
        self.assertEqual(self.partner.name, 'Extension contact')
