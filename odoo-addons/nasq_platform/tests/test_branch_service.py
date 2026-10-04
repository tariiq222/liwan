# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestBranchService(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env.ref('nasq_platform.tenant_profile')
        cls.profile._nasq_initialize_legacy_policy(
            cls.env['nasq.feature.registry']._nasq_installed_module_ids(),
        )
        cls._op(cls).write({'features': {**cls.profile.features, 'branches.extra_limit': 3}})

    def _op(self):
        return self.profile.with_context(**{OPERATOR_CONTEXT: True})

    def _set_limit(self, limit):
        self._op().write({'features': {**self.profile.features, 'branches.extra_limit': limit}})

    def _apply(self, uids, op='op-1'):
        return self._op()._nasq_apply_branches(
            op, 'rev-1', [{'branch_id': uid, 'name': f'Branch {uid}'} for uid in uids],
        )

    def test_hq_not_counted_and_limit_blocks_fourth(self):
        self._apply(['b1', 'b2', 'b3'])
        with self.assertRaises(NasqAccessRule):
            self._apply(['b4'], 'op-2')
        self.assertEqual(self.env['nasq.tenant.branch'].search_count([]), 3)

    def test_idempotent_replay(self):
        first = self._apply(['b1'])
        again = self._apply(['b1'])
        self.assertEqual(first, again)
        self.assertEqual(self.env['nasq.tenant.branch'].search_count([('branch_uid', '=', 'b1')]), 1)
        company = self.env['res.company'].browse(first[0]['odoo_company_id'])
        self.assertEqual(company.parent_id, self.profile.root_company_id)

    def test_conflict_on_archived_binding(self):
        self._apply(['b1'])
        self._op()._nasq_archive_branch('op-2', 'b1')
        with self.assertRaisesRegex(ValidationError, 'branch_binding_conflict'):
            self._apply(['b1'], 'op-3')

    def test_non_su_child_company_blocked(self):
        with self.assertRaisesRegex(AccessError, 'branch_requires_subscription'):
            self.env['res.company'].with_user(
                self.env.ref('base.user_admin'),
            ).create({'name': 'X', 'parent_id': self.profile.root_company_id.id})

    def test_non_operator_rejected(self):
        with self.assertRaises(AccessError):
            self.profile._nasq_apply_branches('op', 'r', [{'branch_id': 'b1', 'name': 'B'}])
        with self.assertRaises(AccessError):
            self.profile.with_context(**{OPERATOR_CONTEXT: True}).with_user(
                self.env.ref('base.user_admin'),
            )._nasq_apply_branches('op', 'r', [{'branch_id': 'b1', 'name': 'B'}])

    def test_archive_preserves_company(self):
        company_id = self._apply(['b1'])[0]['odoo_company_id']
        self._op()._nasq_archive_branch('op-2', 'b1')
        branch = self.env['nasq.tenant.branch'].search([('branch_uid', '=', 'b1')])
        self.assertEqual(branch.state, 'archived')
        company = self.env['res.company'].with_context(active_test=False).browse(company_id)
        self.assertTrue(company.exists())
        self.assertFalse(company.active)

    def test_bind_outside_root_rejected(self):
        self._apply(['b1'])
        user = self.env['res.users'].with_context(no_reset_password=True).create({
            'name': 'Branch User', 'login': 'branch_user',
        })
        self._op()._nasq_bind_user_to_branch(user, 'b1')
        self.assertEqual(user.company_id.name, 'Branch b1')
        branch = self.env['nasq.tenant.branch'].search([('branch_uid', '=', 'b1')])
        outside = self.env['res.company'].create({'name': 'Outside root'})
        branch.company_id = outside
        with self.assertRaisesRegex(ValidationError, 'branch_binding_conflict'):
            self._op()._nasq_bind_user_to_branch(user, 'b1')

    def test_commercial_fields_protected(self):
        for field, value in (
            ('commercial_revision_id', 'r'), ('commercial_digest', 'd'),
            ('commercial_applied_at', '2026-01-01 00:00:00'),
        ):
            with self.assertRaises(AccessError):
                self.profile.write({field: value})
        revision = self.profile.policy_revision
        self._op().write({'commercial_revision_id': 'r1'})
        self.assertEqual(self.profile.commercial_revision_id, 'r1')
        self.assertEqual(self.profile.policy_revision, revision)

    def test_zero_limit_blocks_first_extra_branch_and_null_allows(self):
        self._set_limit(0)
        with self.assertRaises(NasqAccessRule):
            self._apply(['zero'])
        self.assertFalse(self.env['nasq.tenant.branch'].search([]))
        self._set_limit(None)
        self._apply(['unlimited'])
        self.assertEqual(self.env['nasq.tenant.branch'].search_count([]), 1)

    def test_legacy_absence_keeps_unlimited_branch_semantics(self):
        self._op().write({'features': {k: v for k, v in self.profile.features.items()
                                     if k != 'branches.extra_limit'}})
        self._apply(['legacy'])
        self.assertNotIn('branches.extra_limit', self.profile.features)
        self.assertEqual(self.env['nasq.tenant.branch'].search_count([]), 1)

    def test_one_limit_permits_one_and_refuses_next(self):
        self._set_limit(1)
        self._apply(['one'])
        with self.assertRaises(NasqAccessRule):
            self._apply(['two'], 'op-2')

    def test_branch_company_rule_and_employee_write_guards(self):
        self._apply(['a', 'b'])
        branches = self.env['nasq.tenant.branch'].search([])
        a = branches.filtered(lambda branch: branch.branch_uid == 'a')
        b = branches.filtered(lambda branch: branch.branch_uid == 'b')
        employee = new_test_user(self.env, login='branch_scoped_employee', groups='base.group_user',
                                 company_id=a.company_id.id, company_ids=[(6, 0, [a.company_id.id])])
        allowed = self.env['nasq.tenant.branch'].with_user(employee).with_context(allowed_company_ids=[a.company_id.id])
        self.assertEqual(allowed.search([]).ids, a.ids)
        self.assertEqual(allowed.browse(a.id).read(['branch_uid'])[0]['branch_uid'], 'a')
        with self.assertRaises(AccessError):
            allowed.browse(b.id).read(['branch_uid'])
        with self.assertRaises(AccessError):
            allowed.with_context(allowed_company_ids=[b.company_id.id]).search([])
        forged = allowed.with_context(**{OPERATOR_CONTEXT: True})
        for action in (
            lambda: forged.create({'branch_uid': 'forged', 'company_id': a.company_id.id, 'operation_id': 'bad'}),
            lambda: forged.browse(a.id).write({'operation_id': 'bad'}),
            lambda: forged.browse(a.id).unlink(),
            lambda: self._op().with_user(employee)._nasq_apply_branches('bad', 'bad', []),
        ):
            with self.assertRaises(AccessError):
                action()
        employee.company_ids = [(6, 0, [a.company_id.id, b.company_id.id])]
        self.assertEqual(allowed.search([]).ids, a.ids)
        self.assertEqual(allowed.with_context(allowed_company_ids=[b.company_id.id]).search([]).ids, b.ids)
        hq_user = new_test_user(self.env, login='branch_hq_employee', groups='base.group_user',
                                company_id=self.profile.root_company_id.id,
                                company_ids=[(6, 0, self.profile.root_company_id.ids)])
        self.assertFalse(self.env['nasq.tenant.branch'].with_user(hq_user).with_context(
            allowed_company_ids=self.profile.root_company_id.ids,
        ).search([]))
        hq_operator = self._op().with_context(allowed_company_ids=self.profile.root_company_id.ids)
        hq_operator._nasq_archive_branch('archive-b', 'b')
        self.assertEqual(b.state, 'archived')
