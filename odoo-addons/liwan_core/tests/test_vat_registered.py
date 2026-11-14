# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.testing import skip_unless_vat_checked

SAUDI_VAT = '300000000000003'
ACTION = 'company.vat_registration_changed'
MIGRATION_DIR = Path(__file__).parents[1] / 'migrations' / '19.0.1.18.0'
MIGRATION = MIGRATION_DIR / 'post-establishment-vat.py'
BEFORE = '19.0.1.17.0'


def load_migration():
    spec = importlib.util.spec_from_file_location('post_establishment_vat', MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'liwan')
class TestVatRegistered(TransactionCase):
    """The establishment's VAT registration: off by default, one helper every layer reads, and an audited change."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.country = cls.env.ref('base.sa')
        cls.settings_admin = new_test_user(
            cls.env, login='vat_settings_admin', password='vat_settings_admin_123',
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.settings_admin, [{
            'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.company.id,
        }])

    def setUp(self):
        super().setUp()
        self.company.write({'country_id': self.country.id, 'liwan_vat_registered': False, 'vat': False})

    def events(self, company=None):
        return self.env['liwan.access.audit'].search([
            ('action', '=', ACTION), ('target_id', '=', (company or self.company).id),
        ], order='id')

    def branch(self, root=None, name='Branch'):
        return self.env['res.company'].create({'name': name, 'parent_id': (root or self.company).id})

    def branch_only_user(self, branch):
        """An ordinary employee whose only membership is ``branch``: the base rule hides the root from it."""
        user = new_test_user(
            self.env, login=f'vat_branch_{branch.id}', groups='liwan_core.group_employee',
            company_id=branch.id, company_ids=[Command.set(branch.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': branch.id,
        }])
        return user

    def test_a_company_is_not_registered_for_vat_by_default(self):
        company = self.env['res.company'].create({'name': 'Unregistered', 'country_id': self.country.id})
        self.assertFalse(company.liwan_vat_registered)
        self.assertFalse(company._liwan_vat_registered())

    def test_the_helper_answers_for_the_company_it_is_called_on(self):
        other = self.env['res.company'].create({
            'name': 'Other', 'country_id': self.country.id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True,
        })
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertTrue(other._liwan_vat_registered())
        other.write({'liwan_vat_registered': False})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertFalse(other._liwan_vat_registered())
        with self.assertRaises(ValueError):
            self.env['res.company']._liwan_vat_registered()

    def test_registering_without_a_vat_number_is_refused(self):
        for vat in (False, ''):
            with self.subTest(vat=vat), self.assertRaises(ValidationError), self.cr.savepoint():
                self.company.write({'vat': vat, 'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)

    def test_the_number_check_is_the_module_not_the_method_account_also_defines(self):
        module = type(self.env['ir.module.module'])
        company = self.env['res.company']
        with patch.object(module, '_installed', lambda _model: {'account': 1}):
            self.assertFalse(company._liwan_vat_number_is_checked())
        with patch.object(module, '_installed', lambda _model: {'account': 1, 'base_vat': 2}):
            self.assertTrue(company._liwan_vat_number_is_checked())

    def test_registering_with_a_number_that_is_not_the_country_format_is_refused(self):
        skip_unless_vat_checked(self)
        for vat in ('12345', '400000000000003'):
            with self.subTest(vat=vat), self.assertRaises(ValidationError), self.cr.savepoint():
                self.company.write({'vat': vat, 'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)

    def test_registering_with_a_valid_number_registers_the_company(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        self.assertEqual(self.company.vat, SAUDI_VAT)

    def test_a_registered_company_cannot_lose_its_number(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.company.vat = False
        self.assertTrue(self.company._liwan_vat_registered())

    def test_turning_it_off_keeps_the_number_and_needs_none(self):
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.company.write({'liwan_vat_registered': False})
        self.assertFalse(self.company._liwan_vat_registered())
        self.assertEqual(self.company.vat, SAUDI_VAT)

    def test_every_change_is_audited_without_the_number(self):
        self.company.write({'vat': SAUDI_VAT})
        self.company.write({'liwan_vat_registered': True})
        self.company.write({'liwan_vat_registered': False})
        events = self.events()
        self.assertEqual(events.mapped('after'), [{'vat_registered': True}, {'vat_registered': False}])
        self.assertEqual(set(events.mapped('target_type')), {'company'})
        for column in ('before', 'after'):
            self.assertNotIn(SAUDI_VAT, str(events.mapped(column)))

    def test_a_company_created_already_registered_is_audited(self):
        created = self.env['res.company'].create({
            'name': 'Born registered', 'country_id': self.country.id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True,
        })
        events = self.events(created)
        self.assertEqual(events.mapped('before'), [{'vat_registered': False}])
        self.assertEqual(events.mapped('after'), [{'vat_registered': True}])
        unregistered = self.env['res.company'].create({'name': 'Born unregistered', 'country_id': self.country.id})
        self.assertFalse(self.events(unregistered))

    def test_a_write_that_changes_nothing_else_audits_nothing_extra(self):
        self.company.write({'vat': SAUDI_VAT})
        self.company.write({'city': 'Riyadh'})
        self.assertFalse(self.events())

    def test_the_profile_helper_writes_it_and_records_its_author(self):
        company = self.company.with_user(self.settings_admin)
        company._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.company._liwan_vat_registered())
        event = self.events()[-1:]
        self.assertEqual(event.actor_id, self.settings_admin)
        self.assertEqual(event.after, {'vat_registered': True})

    def test_an_ordinary_employee_cannot_change_it(self):
        employee = new_test_user(self.env, login='vat_employee', groups='liwan_core.group_employee')
        with self.assertRaises(AccessError), self.cr.savepoint():
            self.company.with_user(employee)._liwan_write_company_profile({'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)

    def _permissions(self, *keys):
        return self.env['liwan.access.permission'].search([('key', 'in', list(keys))])

    def test_only_the_system_administrator_role_holds_the_right_to_change_it(self):
        key = 'settings.company.vat.manage'
        self.assertIn(key, self.env.ref('liwan_core.role_system_admin').permission_ids.mapped('key'))
        self.assertNotIn(key, self.env.ref('liwan_core.role_vendor_support').permission_ids.mapped('key'))
        permission = self._permissions(key)
        self.assertEqual((permission.custom_role_allowed, permission.sensitive), (False, True))
        with self.assertRaises(ValidationError, msg='no custom role may hold it'), self.cr.savepoint():
            self.env['liwan.access.role'].create({
                'key': 'vat_custom', 'name_ar': 'مخصص', 'type': 'custom', 'company_id': self.company.id,
                'permission_ids': [(6, 0, (permission | self._permissions('settings.company.manage', 'settings.company.read')).ids)],
            })

    def test_a_company_profile_manager_without_the_right_cannot_change_the_registration(self):
        role = self.env['liwan.access.role'].create({
            'key': 'vat_profile_manager', 'name_ar': 'مدير الملف', 'type': 'custom', 'company_id': self.company.id,
            'permission_ids': [(6, 0, self._permissions('settings.company.manage', 'settings.company.read').ids)],
        })
        manager = new_test_user(self.env, login='vat_profile_manager', groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(manager, [{'role_id': role.id, 'company_id': self.company.id}])
        company = self.company.with_user(manager)
        with self.assertRaises(AccessError), self.cr.savepoint():
            company._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertFalse(self.company.liwan_vat_registered)
        # The rest of the profile, and the value it already has, stay open to the same caller.
        company._liwan_write_company_profile({'city': 'Jeddah', 'liwan_vat_registered': False})
        self.assertEqual(self.company.city, 'Jeddah')
        self.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        with self.assertRaises(AccessError), self.cr.savepoint():
            company._liwan_write_company_profile({'liwan_vat_registered': False})
        self.assertTrue(self.company.liwan_vat_registered)


@tagged('post_install', '-at_install', 'liwan')
class TestEstablishmentVatRegistration(TransactionCase):
    """The registration is one decision for the establishment: its root stores it and every branch answers it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.country = cls.env.ref('base.sa')
        cls.root = cls.env['res.company'].create({'name': 'VAT root', 'country_id': cls.country.id})
        cls.branch = cls.env['res.company'].create({
            'name': 'VAT branch', 'parent_id': cls.root.id, 'country_id': cls.country.id,
        })
        cls.grandchild = cls.env['res.company'].create({
            'name': 'VAT sub-branch', 'parent_id': cls.branch.id, 'country_id': cls.country.id,
        })
        cls.admin_role = cls.env.ref('liwan_core.role_system_admin')

    def setUp(self):
        super().setUp()
        self.root.write({'vat': False, 'liwan_vat_registered': False})
        self.root_events = self.env['liwan.access.audit'].search([
            ('action', '=', ACTION), ('target_id', '=', self.root.id),
        ], order='id')

    def member(self, login, company, role=None):
        user = new_test_user(
            self.env, login=login, groups='liwan_core.group_employee',
            company_id=company.id, company_ids=[Command.set(company.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': (role or self.admin_role).id, 'company_id': company.id,
        }])
        return user

    def new_events(self):
        last = self.root_events[-1:].id or 0
        return self.env['liwan.access.audit'].search([
            ('action', '=', ACTION), ('target_id', '=', self.root.id), ('id', '>', last),
        ], order='id')

    def test_a_new_branch_takes_its_root_registration(self):
        root = self.env['res.company'].create({
            'name': 'Registered root', 'country_id': self.country.id, 'vat': SAUDI_VAT, 'liwan_vat_registered': True,
        })
        branch = self.env['res.company'].create({'name': 'New branch', 'parent_id': root.id})
        self.assertFalse(branch.liwan_vat_registered, 'the decision is stored on the root only')
        self.assertTrue(branch._liwan_vat_registered())
        self.assertFalse(self.env['liwan.access.audit'].search_count([
            ('action', '=', ACTION), ('target_id', '=', branch.id),
        ]))

    def test_a_root_change_reaches_every_branch_and_the_audit_names_the_root_once(self):
        self.root.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual(
            (self.branch._liwan_vat_registered(), self.grandchild._liwan_vat_registered()), (True, True),
        )
        self.assertEqual(
            (self.branch.liwan_vat_registered, self.grandchild.liwan_vat_registered), (False, False),
            'a branch row never holds the decision',
        )
        events = self.new_events()
        self.assertEqual(len(events), 1, 'one decision, one entry')
        self.assertEqual(events.after, {'vat_registered': True})
        self.assertFalse(self.env['liwan.access.audit'].search([
            ('action', '=', ACTION), ('target_id', 'in', (self.branch | self.grandchild).ids),
        ]))

    def test_a_branch_answers_the_establishment_value_from_a_branch_only_session(self):
        self.root.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        user = self.member('vat_branch_reader', self.branch, role=self.env.ref('liwan_core.role_employee'))
        branch_env = self.branch.with_user(user).with_company(self.branch)
        self.assertEqual(branch_env.env.user.company_ids, self.branch)
        # The premise: base's res_company_rule_employee hides a stored field of the root from that session.
        with self.assertRaises(AccessError):
            branch_env.root_id.liwan_vat_registered  # noqa: B018 - the precondition: the root row is unreadable here
        self.assertTrue(branch_env._liwan_vat_registered())
        self.root.write({'liwan_vat_registered': False})
        self.assertFalse(branch_env._liwan_vat_registered())

    def test_an_elevated_caller_gets_the_same_answer(self):
        self.root.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.branch.sudo()._liwan_vat_registered())
        self.assertTrue(self.branch.sudo().with_company(self.branch)._liwan_vat_registered())
        self.root.write({'liwan_vat_registered': False})
        self.assertFalse(self.branch.sudo()._liwan_vat_registered())

    def test_a_branch_cannot_store_the_decision_itself(self):
        # A superuser write is refused by the model constraint, so no writer can leave a second answer in a branch.
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.branch.write({'liwan_vat_registered': True})
        self.env.invalidate_all()
        self.assertFalse(self.branch.liwan_vat_registered)
        # The value it already carries writes nothing, and records nothing.
        before = len(self.env['liwan.access.audit'].search([]))
        self.branch.write({'liwan_vat_registered': False})
        self.assertEqual(len(self.env['liwan.access.audit'].search([])), before)

    def test_a_branch_cannot_be_created_already_registered(self):
        # Whoever creates it, a branch row never carries the decision: the constraint refuses the create too.
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.env['res.company'].create({
                'name': 'Born registered branch', 'parent_id': self.root.id, 'country_id': self.country.id,
                'liwan_vat_registered': True,
            })
        self.assertFalse(self.env['res.company'].search([('name', '=', 'Born registered branch')]))

    def test_a_root_change_reaches_the_sub_branch_in_the_same_transaction(self):
        # Three levels: the sub-branch answers from its own parent chain, with no read of the root.
        self.assertEqual(self.grandchild.parent_id, self.branch)
        self.assertEqual(self.branch.parent_id, self.root)
        self.assertFalse(self.grandchild._liwan_vat_registered())
        self.root.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertTrue(self.grandchild.liwan_establishment_vat_registered)
        self.assertTrue(self.grandchild._liwan_vat_registered())
        self.root.write({'liwan_vat_registered': False})
        self.assertFalse(self.grandchild.liwan_establishment_vat_registered)
        self.assertFalse(self.grandchild._liwan_vat_registered())

    def test_a_branch_under_an_unregistered_root_answers_not_registered(self):
        # An old row that stored its own registration, under a root that is not registered: the migration refuses it
        # by name, because one decision per establishment cannot be guessed. The realigned shape, where the branch
        # row equals its root, answers from the establishment: not registered, whatever the old row said.
        self.env.cr.execute('UPDATE res_company SET liwan_vat_registered = TRUE WHERE id = %s', [self.branch.id])
        self.env.invalidate_all()
        with self.assertRaises(ValidationError) as raised:
            load_migration().migrate(self.env.cr, BEFORE)
        self.assertIn(self.branch.display_name, str(raised.exception))
        self.env.cr.execute('UPDATE res_company SET liwan_vat_registered = FALSE WHERE id = %s', [self.branch.id])
        self.env.invalidate_all()
        load_migration().migrate(self.env.cr, BEFORE)
        self.env.invalidate_all()
        self.assertFalse(self.branch._liwan_vat_registered())

    def test_the_profile_helper_refuses_a_registration_change_in_a_branch_session(self):
        admin = self.member('vat_branch_admin', self.branch)
        branch = self.branch.with_user(admin).with_company(self.branch)
        with self.assertRaises(AccessError) as raised, self.cr.savepoint():
            branch._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual(raised.exception.args[0].split(':')[0], 'vat_registration_is_set_on_the_root')
        self.assertFalse(self.root.liwan_vat_registered)
        # The same value the establishment has changes nothing, and needs no right for it.
        branch._liwan_write_company_profile({'city': 'Riyadh', 'liwan_vat_registered': False})
        self.assertEqual(branch.city, 'Riyadh')
        self.assertFalse(self.root.liwan_vat_registered)
        # The rest of the profile alone stays a plain write on the branch.
        branch._liwan_write_company_profile({'city': 'Dammam'})
        self.assertEqual(self.branch.city, 'Dammam')
        # The branch's own store never became the establishment's answer.
        self.env.invalidate_all()
        self.assertFalse(self.branch.liwan_vat_registered)

    def test_the_root_changes_it_with_the_vat_right_and_every_branch_follows(self):
        admin = self.member('vat_root_admin', self.root)
        root = self.root.with_user(admin).with_company(self.root)
        root._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertEqual(
            (self.root._liwan_vat_registered(), self.branch._liwan_vat_registered(),
             self.grandchild._liwan_vat_registered()),
            (True, True, True),
        )
        self.assertEqual(len(self.new_events()), 1)

    def test_the_root_session_without_the_vat_right_is_refused(self):
        # A built-in role keeps the company given to it; a custom one is bound to the creating session's company.
        role = self.env['liwan.access.role'].create({
            'key': 'vat_manage_only', 'name_ar': 'مدير', 'type': 'built_in', 'company_id': self.root.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['settings.company.read', 'settings.company.manage']),
            ]).ids)],
        })
        manager = new_test_user(
            self.env, login='vat_manage_only_user', groups='liwan_core.group_employee',
            company_id=self.root.id, company_ids=[Command.set(self.root.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(manager, [{'role_id': role.id, 'company_id': self.root.id}])
        root = self.root.with_user(manager).with_company(self.root)
        with self.assertRaises(AccessError), self.cr.savepoint():
            root._liwan_write_company_profile({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        self.assertFalse(self.root.liwan_vat_registered)
        # Editing the rest of the profile still works, and resending the value it already has needs no right.
        root._liwan_write_company_profile({'city': 'Jeddah', 'liwan_vat_registered': False})
        self.assertEqual(self.root.city, 'Jeddah')

    def test_only_the_root_is_editable_from_the_company_the_session_acts_on(self):
        root_admin = self.member('vat_root_editable', self.root)
        branch_admin = self.member('vat_branch_editable', self.branch)
        self.assertTrue(self.root.with_user(root_admin)._liwan_vat_registration_editable())
        self.assertFalse(self.branch.with_user(branch_admin)._liwan_vat_registration_editable())


@tagged('post_install', '-at_install', 'liwan')
class TestVatRegistrationMigration(TransactionCase):
    """19.0.1.18.0: a branch row is realigned to its root, and an ambiguous one stops the upgrade by name."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.country = cls.env.ref('base.sa')
        cls.root = cls.env['res.company'].create({'name': 'Migration root', 'country_id': cls.country.id})
        cls.registered_branch = cls.env['res.company'].create({
            'name': 'Migration registered branch', 'parent_id': cls.root.id, 'country_id': cls.country.id,
        })
        cls.clean_branch = cls.env['res.company'].create({
            'name': 'Migration clean branch', 'parent_id': cls.root.id, 'country_id': cls.country.id,
        })
        cls.root.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})

    def setUp(self):
        super().setUp()
        self.root.write({'liwan_vat_registered': True})
        # The old shape: a branch row that stored its own value, as versions before 19.0.1.18.0 allowed.
        self.env.cr.execute(
            'UPDATE res_company SET liwan_vat_registered = TRUE WHERE id IN %s',
            [tuple((self.registered_branch | self.clean_branch).ids)],
        )
        self.env.invalidate_all()

    def test_a_branch_row_is_cleared_and_the_root_answers_for_it(self):
        load_migration().migrate(self.env.cr, BEFORE)
        self.env.invalidate_all()
        self.assertEqual(
            (self.root.liwan_vat_registered, self.registered_branch.liwan_vat_registered,
             self.clean_branch.liwan_vat_registered),
            (True, False, False),
        )
        self.assertEqual(
            (self.registered_branch._liwan_vat_registered(), self.clean_branch._liwan_vat_registered()),
            (True, True),
        )
        self.assertTrue(self.registered_branch._liwan_vat_registered())
        # Idempotent: a rerun changes nothing.
        load_migration().migrate(self.env.cr, BEFORE)
        self.env.invalidate_all()
        self.assertFalse(self.registered_branch.liwan_vat_registered)

    def test_a_branch_registered_under_an_unregistered_root_stops_the_upgrade_naming_both(self):
        self.root.write({'liwan_vat_registered': False})
        with self.assertRaises(ValidationError) as raised:
            load_migration().migrate(self.env.cr, BEFORE)
        # The message names the branch it stopped on and the root the operator has to decide for.
        self.assertTrue(
            self.registered_branch.display_name in str(raised.exception)
            or self.clean_branch.display_name in str(raised.exception),
        )
        self.assertIn(self.root.display_name, str(raised.exception))

    def test_a_fresh_install_has_nothing_to_migrate(self):
        self.assertEqual(load_migration().migrate(self.env.cr, False), None)
