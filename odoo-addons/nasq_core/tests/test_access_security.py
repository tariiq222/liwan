# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq', 'nasq_access')
class TestNasqAccessSecurity(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.company = cls.env.company
        cls.admin_a = new_test_user(
            cls.env, login='access_admin_a', groups='base.group_user',
        )
        cls.admin_b = new_test_user(
            cls.env, login='access_admin_b', groups='base.group_user',
        )
        system_role = cls.env.ref('nasq_core.role_system_admin')
        for user in (cls.admin_a, cls.admin_b):
            cls.service._nasq_replace_assignments(
                user, [{'role_id': system_role.id, 'company_id': cls.company.id}],
            )

    def test_system_admin_has_no_hr_or_pmo_management(self):
        self.assertTrue(self.service._nasq_has_capability(
            self.admin_a, 'access.users.assign_roles',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'hr.employees.manage',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'pmo.projects.manage',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'pmo.tasks.write',
        ))
        self.assertFalse(self.admin_a.has_group('base.group_erp_manager'))
        self.assertFalse(self.admin_a.has_group('hr.group_hr_manager'))
        self.assertFalse(self.admin_a.has_group('project.group_project_manager'))

    def test_system_admin_cannot_write_arbitrary_employee_contact(self):
        partner = self.env['res.partner'].create({
            'name': 'Unrelated employee contact',
            'company_id': self.company.id,
        })
        with self.assertRaisesRegex(AccessError, 'use_protected_nasq_access_operation'):
            partner.with_user(self.admin_a).write({'email': 'changed@example.com'})

    def test_self_vendor_and_last_admin_guards(self):
        version = self.service._nasq_user_version(self.admin_a)
        with self.assertRaisesRegex(ValidationError, 'self_access_change'):
            self.service.with_user(self.admin_a)._nasq_disable_user(
                self.admin_a, version,
            )

        vendor = new_test_user(
            self.env, login='access_vendor', groups='nasq_core.group_vendor_support',
        )
        with self.assertRaisesRegex(AccessError, 'protected_user'):
            self.service.with_user(self.admin_a)._nasq_disable_user(
                vendor, self.service._nasq_user_version(vendor),
            )

        isolated_company = self.env['res.company'].create({
            'name': 'Isolated last-admin company',
        })
        isolated_admins = [
            new_test_user(
                self.env, login=f'isolated_access_admin_{suffix}',
                groups='base.group_user', company_id=isolated_company.id,
            )
            for suffix in ('a', 'b')
        ]
        system_role = self.env.ref('nasq_core.role_system_admin')
        for user in isolated_admins:
            self.service._nasq_replace_assignments(user, [{
                'role_id': system_role.id,
                'company_id': isolated_company.id,
            }])
        isolated_env = self.env(
            user=isolated_admins[0],
            context={'allowed_company_ids': [isolated_company.id]},
        )
        isolated_service = isolated_env['nasq.access.service']
        isolated_admin_b = isolated_env['res.users'].browse(isolated_admins[1].id)
        isolated_service._nasq_disable_user(
            isolated_admin_b,
            isolated_service._nasq_user_version(isolated_admin_b),
        )
        with self.assertRaisesRegex(ValidationError, 'last_access_admin'):
            isolated_service._nasq_assert_admin_survives(
                isolated_env.company, excluding_user=isolated_env.user,
            )

    def test_stale_user_version_conflicts(self):
        stale = self.service._nasq_user_version(self.admin_b)
        self.admin_b.write({'name': 'Changed elsewhere'})
        with self.assertRaisesRegex(ValidationError, 'conflict'):
            self.service._nasq_check_user_version(self.admin_b, stale)

    def test_audit_failure_rolls_back_access_mutation(self):
        version = self.service._nasq_user_version(self.admin_b)
        audit_model = type(self.env['nasq.access.audit'])
        with self.assertRaisesRegex(RuntimeError, 'audit injection'):
            with self.env.cr.savepoint():
                with patch.object(audit_model, '_nasq_log', side_effect=RuntimeError('audit injection')):
                    self.service.with_user(self.admin_a)._nasq_disable_user(self.admin_b, version)
        self.admin_b.invalidate_recordset(['active'])
        self.assertTrue(self.admin_b.active)

    def test_current_company_limits_capabilities_and_access_records(self):
        company_b = self.env['res.company'].create({'name': 'Access company B'})
        actor = new_test_user(
            self.env, login='access_multi_company', groups='base.group_user',
            company_id=self.company.id,
        )
        actor.write({'company_ids': [(6, 0, [self.company.id, company_b.id])]})
        self.service._nasq_replace_assignments(actor, [{
            'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.company.id,
        }])
        role_a = self.env['nasq.access.role']._nasq_access_create({
            'name_ar': 'دور الشركة أ',
        })
        role_b = self.env['nasq.access.role'].with_company(
            company_b,
        )._nasq_access_create({'name_ar': 'دور الشركة ب'})
        user_b = new_test_user(
            self.env, login='access_company_b_user', groups='base.group_user',
            company_id=company_b.id,
        )
        self.service._nasq_replace_assignments(user_b, [{
            'role_id': self.env.ref('nasq_core.role_employee').id,
            'company_id': company_b.id,
        }])
        audit_a = self.env['nasq.access.audit']._nasq_log(
            'role.created', role_a, actor=False,
        )
        audit_b = self.env['nasq.access.audit'].with_company(
            company_b,
        )._nasq_log('role.created', role_b, actor=False)

        env_a = self.env(
            user=actor,
            context={'allowed_company_ids': [self.company.id, company_b.id]},
        )
        self.assertEqual(env_a.company, self.company)
        self.assertTrue(env_a['nasq.access.service']._nasq_has_capability(
            actor.with_env(env_a), 'access.users.assign_roles',
        ))
        self.assertIn(role_a, env_a['nasq.access.role'].search([]))
        self.assertNotIn(role_b, env_a['nasq.access.role'].search([]))
        self.assertIn(audit_a, env_a['nasq.access.audit'].search([]))
        self.assertNotIn(audit_b, env_a['nasq.access.audit'].search([]))

        env_b = self.env(
            user=actor,
            context={'allowed_company_ids': [company_b.id, self.company.id]},
        )
        self.assertEqual(env_b.company, company_b)
        self.assertFalse(env_b['nasq.access.service']._nasq_has_capability(
            actor.with_env(env_b), 'access.users.assign_roles',
        ))
        with self.assertRaises(AccessError):
            env_b['nasq.access.role'].search([])
        with self.assertRaises(AccessError):
            env_b['nasq.access.assignment'].search([])
        with self.assertRaises(AccessError):
            env_b['nasq.access.audit'].search([])

    def test_legacy_groups_do_not_cross_companies_or_return_after_role_removal(self):
        company_b = self.env['res.company'].create({'name': 'Legacy group company B'})
        legacy = new_test_user(
            self.env, login='legacy_managed_access',
            groups='nasq_core.group_customer_admin', company_id=self.company.id,
        )
        legacy.write({'company_ids': [(6, 0, [self.company.id, company_b.id])]})
        env_b = self.env(
            user=legacy,
            context={'allowed_company_ids': [company_b.id, self.company.id]},
        )
        self.assertFalse(env_b['nasq.access.service']._nasq_has_capability(
            legacy.with_env(env_b), 'access.users.assign_roles',
        ))

        self.service._nasq_replace_assignments(legacy, [{
            'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.company.id,
        }])
        self.service.with_user(self.admin_a)._nasq_replace_assignments(legacy, [])
        legacy.invalidate_recordset(['nasq_access_managed'])
        self.assertTrue(legacy.nasq_access_managed)
        self.assertFalse(self.service._nasq_has_capability(
            legacy, 'access.users.assign_roles', company=self.company,
        ))

    def test_password_reset_does_not_read_foreign_notification_sender(self):
        company_b = self.env['res.company'].create({
            'name': 'Password reset company B',
        })
        actor = new_test_user(
            self.env, login='password_reset_admin', email=False,
            groups='base.group_user', company_id=company_b.id,
        )
        target = new_test_user(
            self.env, login='legacy_password_target',
            groups='base.group_user', company_id=company_b.id,
        )
        self.assertEqual(target.create_uid, self.env.ref('base.user_root'))
        self.assertNotEqual(target.create_uid.company_id, company_b)
        self.service._nasq_replace_assignments(actor, [{
            'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': company_b.id,
        }])

        actor_env = self.env(
            user=actor,
            context={'allowed_company_ids': [company_b.id]},
        )
        service = actor_env['nasq.access.service']
        target = actor_env['res.users'].browse(target.id)
        service._nasq_reset_password(
            target, 'legacy_password_reset_123',
            service._nasq_user_version(target),
        )

        audit = actor_env['nasq.access.audit'].search([
            ('action', '=', 'user.password_reset'),
            ('target_id', '=', target.id),
        ])
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit.after, {'sessions_revoked': True})
