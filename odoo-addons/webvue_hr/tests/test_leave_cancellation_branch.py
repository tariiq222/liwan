# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Cancellation keeps the parent authorization root and the leave's company."""
from contextlib import nullcontext
from datetime import date, timedelta
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import CompanyIsolationCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestLeaveCancellationBranch(CompanyIsolationCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.iso_user.group_ids |= cls.env.ref('base.group_allow_export')
        cls.manager_role = cls.env.ref('webvue_hr.role_hr_manager')
        cls.manager_assignments = cls.env['webvue.access.assignment'].create([
            {'user_id': cls.iso_user.id, 'company_id': company.id, 'role_id': cls.manager_role.id}
            for company in (cls.company_p, cls.company_p1)
        ])
        cls.kind = cls.env['hr.leave.type'].create({
            'name': 'Branch cancellation', 'company_id': False, 'country_id': False,
            'requires_allocation': False, 'leave_validation_type': 'hr',
            'work_entry_type_id': cls.env.ref('hr_work_entry.work_entry_type_leave').id,
        })
        start = date.today() + timedelta(days=30)
        cls.day = start + timedelta(days=(7 - start.weekday()) % 7)
        cls.owners, cls.staff, cls.leaves, cls.cancellations = {}, {}, {}, {}
        for company in (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c):
            owner = new_test_user(cls.env, login=f'cancel_branch_owner_{company.id}', groups='webvue_core.group_employee', password='branch_owner_pass_123',
                                  company_id=company.id, company_ids=[Command.set(company.ids)])
            cls.env['webvue.access.service']._webvue_replace_assignments(owner, [{
                'role_id': cls.env.ref('webvue_core.role_employee').id, 'company_id': company.id,
            }])
            employee = cls.env['hr.employee'].create({'name': company.name + ' owner', 'user_id': owner.id, 'company_id': company.id})
            leave = cls.env['hr.leave'].create({'employee_id': employee.id, 'holiday_status_id': cls.kind.id,
                                              'request_date_from': cls.day, 'request_date_to': cls.day})
            leave.action_approve()
            row = cls.env['webvue.hr.leave.cancellation'].with_user(owner).with_context(
                allowed_company_ids=company.ids,
            ).action_request(leave.id, 'Branch employee reason')
            cls.owners[company.id], cls.staff[company.id] = owner, employee
            cls.leaves[company.id], cls.cancellations[company.id] = leave, row.with_env(cls.env)
        cls.env['webvue.hr.leave.settings'].create({'company_id': cls.company_p.id, 'cancellation_policy': 'manager_only'})
        cls.env['webvue.hr.leave.settings'].create({'company_id': cls.company_p1.id, 'cancellation_policy': 'manager_approval'})

    def _model(self, capability='hr.leave.read'):
        return self.env['webvue.hr.leave.cancellation'].with_user(self.iso_user).with_context(
            allowed_company_ids=(self.company_p | self.company_p1 | self.company_p2 | self.company_c).ids,
            webvue_capability_scope=(((capability,), 'all'),),
        )

    def _branch_assignment(self):
        return self.manager_assignments.filtered(lambda row: row.company_id == self.company_p1)

    def _inherit_manager(self):
        self._branch_assignment().unlink()
        self.company_p.webvue_branch_access_mode = 'inherited'
        return self.env['webvue.access.branch.rule'].create({
            'company_id': self.company_p.id, 'branch_id': self.company_p1.id,
            'inherit': True, 'role_ids': [Command.set(self.manager_role.ids)],
        })

    def _assert_private(self, model, row):
        self.assertFalse(model.search_count([('id', '=', row.id)]))
        record = model.browse(row.id)
        with self.assertRaises(AccessError):
            record.read(['reason'])
        record.invalidate_recordset(['reason'])
        with self.assertRaises(AccessError):
            _reason = record.reason
        with self.assertRaises(AccessError):
            record.export_data(['reason'])

    def test_parent_http_list_uses_each_owning_policy_and_pending_scope(self):
        self.env_in(self.company_p)
        for suffix in ('', '?cancellation_state=pending'):
            response = self.api('GET', '/api/v1/hr/leave/requests' + suffix)
            self.assertEqual(response.status_code, 200, response.text)
            items = {item['id']: item for item in response.json()['items']}
            self.assertEqual(set(items), {self.leaves[self.company_p.id].id, self.leaves[self.company_p1.id].id})
            self.assertEqual(items[self.leaves[self.company_p.id].id]['cancellation_policy'], 'manager_only')
            self.assertEqual(items[self.leaves[self.company_p1.id].id]['cancellation_policy'], 'manager_approval')
            self.assertTrue(items[self.leaves[self.company_p1.id].id]['can_approve_cancellation'])

    def test_parent_http_settings_stays_selected_and_get_does_not_insert(self):
        self.env_in(self.company_p)
        before = self.env['webvue.hr.leave.settings'].search_count([])
        response = self.api('GET', '/api/v1/hr/leave/settings')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['cancellation_policy'], 'manager_only')
        self.assertEqual(self.env['webvue.hr.leave.settings'].search_count([]), before)
        response = self.api('PATCH', '/api/v1/hr/leave/settings', {'cancellation_policy': 'direct_employee', 'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.env['webvue.hr.leave.settings']._webvue_effective_policy(self.company_p1), 'manager_approval')

    def test_delegated_parent_approval_runs_one_ordinary_owner_wizard(self):
        row = self.cancellations[self.company_p1.id]
        model = self._model('hr.leave.approve')
        calls = []
        wizard_class = type(self.env['hr.holidays.cancel.leave'])
        original = wizard_class.action_cancel_leave

        def observe(wizard):
            calls.append((wizard.env.uid, wizard.env.is_superuser(), wizard.env.context['allowed_company_ids']))
            return original(wizard)

        with patch.object(wizard_class, 'action_cancel_leave', observe):
            model.browse(row.id).action_approve(1, 'Parent reviewer reason')
        self.assertEqual(calls, [(self.owners[self.company_p1.id].id, False, self.company_p1.ids)])
        self.assertEqual(self.leaves[self.company_p1.id].state, 'cancel')
        self.assertEqual(row.reviewer_id, self.iso_user)
        self.assertIn('Parent reviewer reason', ' '.join(self.leaves[self.company_p1.id].message_ids.mapped('body')))

    def test_inherited_builtin_parent_http_decision_preserves_authorization_root(self):
        self._inherit_manager()
        self.env_in(self.company_p)
        leave = self.leaves[self.company_p1.id]
        response = self.api('POST', f'/api/v1/hr/leave/requests/{leave.id}/cancellation/approve', {'revision': 1, 'reason': 'Inherited approval'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'cancel')
        self.assertEqual(self.cancellations[self.company_p1.id].reviewer_id, self.iso_user)

    def test_inherited_optout_is_private_with_parent_read_and_global_approval_groups(self):
        rule = self._inherit_manager()
        model = self._model()
        row = self.cancellations[self.company_p1.id]
        self.assertEqual(model.search_count([('id', '=', row.id)]), 1)
        rule.inherit = False
        self._assert_private(model, row)
        with self.assertRaises(AccessError):
            model.browse(row.id).action_approve(1)

    def test_custom_explicit_branch_grant_survives_inheritance_optout(self):
        rule = self._inherit_manager()
        rule.inherit = False
        custom = self.env['webvue.access.role'].with_company(self.company_p1).create({
            'key': 'branch_cancel_custom', 'name_ar': 'Branch cancel', 'type': 'custom', 'assignable': True,
            'company_id': self.company_p1.id, 'permission_ids': [Command.set(self.manager_role.permission_ids.ids)],
        })
        self.env['webvue.access.assignment'].create({'user_id': self.iso_user.id, 'company_id': self.company_p1.id, 'role_id': custom.id})
        row = self._model('hr.leave.approve').browse(self.cancellations[self.company_p1.id].id)
        row.action_refuse(1, 'Explicit custom branch reviewer')
        self.assertEqual(row.state, 'refused')

    def test_warm_approve_to_read_revocation_hides_aggregate_fields_counts_exports(self):
        model = self._model()
        row = self.cancellations[self.company_p1.id]
        self.assertEqual(model.search_count([('id', '=', row.id)]), 1)
        self.assertEqual(model.browse(row.id).read(['reason'])[0]['reason'], 'Branch employee reason')
        self._branch_assignment().unlink()
        self._assert_private(model, row)
        with self.assertRaises(AccessError):
            model.browse(row.id).action_approve(1)
        self.assertEqual(row.state, 'pending')

    def test_isolated_and_membership_only_never_receive_other_aggregate(self):
        model = self._model()
        for company in (self.company_p2, self.company_c):
            self._assert_private(model, self.cancellations[company.id])
        self.company_p.webvue_branch_access_mode = 'isolated'
        self._assert_private(model, self.cancellations[self.company_p1.id])

    def test_native_invisible_leave_also_hides_cancellation_aggregate(self):
        row = self.cancellations[self.company_p1.id]
        self.env['ir.rule'].create({'name': 'Branch cancellation hidden native leave',
                                   'model_id': self.env['ir.model']._get_id('hr.leave'),
                                   'domain_force': repr([('id', '!=', row.leave_id.id)])})
        self._assert_private(self._model(), row)

    def test_reviewer_root_grant_is_rechecked_inside_native_owner_execution(self):
        rule = self._inherit_manager()
        row = self.cancellations[self.company_p1.id]
        wizard_class = type(self.env['hr.holidays.cancel.leave'])
        original = wizard_class.action_cancel_leave

        calls = []

        def revoke(wizard):
            calls.append(wizard.env.uid)
            rule.inherit = False
            return original(wizard)

        with patch.object(wizard_class, 'action_cancel_leave', revoke):
            with self.assertRaises(AccessError):
                self._model('hr.leave.approve').browse(row.id).action_approve(1)
        self.assertEqual(calls, [self.owners[self.company_p1.id].id])
        self.assertEqual((row.state, self.leaves[self.company_p1.id].state), ('pending', 'validate'))
        self.assertFalse(any(isinstance(key, tuple) and key[0] == 'webvue_hr.leave.cancellation.authorization'
                             for key in self.env.cr.precommit.data))

    def test_branch_only_config_does_not_read_or_patch_selected_parent_settings(self):
        self.manager_assignments.filtered(lambda row: row.company_id == self.company_p).unlink()
        self.env_in(self.company_p)
        response = self.api('GET', '/api/v1/hr/leave/settings')
        self.assertEqual(response.status_code, 403, response.text)
        response = self.api('PATCH', '/api/v1/hr/leave/settings', {'cancellation_policy': 'direct_employee', 'revision': 1})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.env['webvue.hr.leave.settings'].search([
            ('company_id', '=', self.company_p.id),
        ]).cancellation_policy, 'manager_only')

    def test_parent_session_own_direct_cancellation_pins_native_wizard_to_branch(self):
        owner = self.owners[self.company_p1.id]
        owner.write({'company_ids': [Command.set((self.company_p | self.company_p1).ids)], 'company_id': self.company_p.id})
        self.env['webvue.access.assignment'].create({
            'user_id': owner.id, 'company_id': self.company_p.id,
            'role_id': self.env.ref('webvue_core.role_employee').id,
        })
        self.cancellations[self.company_p1.id]._webvue_write({'state': 'refused'})
        self.env['webvue.hr.leave.settings'].search([('company_id', '=', self.company_p1.id)]).write({
            'cancellation_policy': 'direct_employee',
        })
        self.authenticate(owner.login, 'branch_owner_pass_123')
        leave = self.leaves[self.company_p1.id]
        response = self.api('POST', f'/api/v1/hr/leave/requests/{leave.id}/cancel', {'reason': 'Own branch cancellation'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'cancel')

    def test_raw_context_cannot_replay_historical_parent_decision(self):
        row = self.cancellations[self.company_p1.id]
        row._webvue_write({'state': 'approved', 'revision': 2, 'reviewer_id': self.iso_user.id})
        owner = self.owners[self.company_p1.id]
        wizard = self.env['hr.holidays.cancel.leave'].with_user(owner).with_context(
            allowed_company_ids=self.company_p1.ids, webvue_cancellation_approved=True,
            cancellation_id=row.id, revision=2, webvue_cancellation_authorization=self.company_p.id,
        ).create({'leave_id': row.leave_id.id})
        with self.assertRaises(AccessError):
            wizard.action_cancel_leave()
        self.assertEqual(row.leave_id.state, 'validate')

    def _inherit_owner(self):
        owner = self.owners[self.company_p1.id]
        owner.write({'company_ids': [Command.set((self.company_p | self.company_p1).ids)], 'company_id': self.company_p.id})
        employee_role = self.env.ref('webvue_core.role_employee')
        self.env['webvue.access.assignment'].search([('user_id', '=', owner.id)]).unlink()
        self.env['webvue.access.service']._webvue_replace_assignments(owner, [{
            'role_id': employee_role.id, 'company_id': self.company_p.id,
        }])
        self.company_p.webvue_branch_access_mode = 'inherited'
        rule = self.env['webvue.access.branch.rule'].create({
            'company_id': self.company_p.id, 'branch_id': self.company_p1.id,
            'inherit': True, 'role_ids': [Command.set(employee_role.ids)],
        })
        return owner, rule

    def test_parent_approval_supports_owner_inherited_employee(self):
        owner, _rule = self._inherit_owner()
        self.env_in(self.company_p)
        leave = self.leaves[self.company_p1.id]
        response = self.api('POST', f'/api/v1/hr/leave/requests/{leave.id}/cancellation/approve', {'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'cancel')
        self.assertEqual(self.cancellations[self.company_p1.id].requester_id, owner)

    def test_inherited_owner_capsule_clears_warm_cache_and_cannot_be_replayed(self):
        owner, _rule = self._inherit_owner()
        leave = self.leaves[self.company_p1.id]
        ordinary = leave.with_user(owner).with_context(allowed_company_ids=self.company_p1.ids, webvue_capability_scope=None)
        service = ordinary.env['webvue.access.service']
        self.assertFalse(service._webvue_has_capability(owner, 'hr.leave.request'))
        model = self._model('hr.leave.approve')
        for fail in (False, True):
            with self.assertRaises(RuntimeError) if fail else nullcontext():
                with model._webvue_owner_authorization(leave.with_env(model.env)) as owned:
                    active = owned.env['webvue.access.service']
                    self.assertTrue(active._webvue_has_capability(owned.env.user, 'hr.leave.request'))
                    self.assertFalse(active._webvue_has_capability(owned.env.user, 'hr.departments.read'))
                    self.assertTrue(owned.env['webvue.hr.leave.cancellation'].search_count([('leave_id', '=', leave.id)]))
                    if fail:
                        message = 'Capsule exception'
                        raise RuntimeError(message)
            self.assertFalse(service._webvue_has_capability(owner, 'hr.leave.request'))
            self.assertFalse(ordinary.env['webvue.hr.leave.cancellation'].search_count([('leave_id', '=', leave.id)]))
        forged = service.with_context(**{'webvue_hr.leave.cancellation.owner_authorization': [(owner.id, self.company_p1.id, leave.id)]})
        self.assertFalse(forged._webvue_has_capability(owner, 'hr.leave.request'))
        self.assertNotIn('webvue_hr.leave.cancellation.owner_authorization', self.env.cr.precommit.data)

    def test_inherited_owner_permission_revocation_inside_wizard_fails_closed(self):
        _owner, rule = self._inherit_owner()
        row = self.cancellations[self.company_p1.id]
        wizard_class = type(self.env['hr.holidays.cancel.leave'])
        original = wizard_class.action_cancel_leave
        calls = []

        def revoke(wizard):
            calls.append(wizard.env.uid)
            self.assertTrue(wizard.env['webvue.access.service']._webvue_has_capability(wizard.env.user, 'hr.leave.request'))
            rule.inherit = False
            return original(wizard)

        with patch.object(wizard_class, 'action_cancel_leave', revoke):
            with self.assertRaises(AccessError):
                self._model('hr.leave.approve').browse(row.id).action_approve(1)
        self.assertEqual(calls, [self.owners[self.company_p1.id].id])
        self.assertEqual((row.state, self.leaves[self.company_p1.id].state), ('pending', 'validate'))
        self.assertNotIn('webvue_hr.leave.cancellation.owner_authorization', self.env.cr.precommit.data)

    def test_parent_session_inherited_owner_direct_policy_uses_native_owner(self):
        owner, _rule = self._inherit_owner()
        self.cancellations[self.company_p1.id]._webvue_write({'state': 'refused'})
        self.env['webvue.hr.leave.settings'].search([('company_id', '=', self.company_p1.id)]).write({
            'cancellation_policy': 'direct_employee',
        })
        self.authenticate(owner.login, 'branch_owner_pass_123')
        leave = self.leaves[self.company_p1.id]
        response = self.api('POST', f'/api/v1/hr/leave/requests/{leave.id}/cancel', {'reason': 'Inherited own branch'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'cancel')
        self.assertNotIn('webvue_hr.leave.cancellation.owner_authorization', self.env.cr.precommit.data)

    def test_inherited_owner_root_membership_revocation_inside_wizard_fails_closed(self):
        owner, _rule = self._inherit_owner()
        row = self.cancellations[self.company_p1.id]
        wizard_class = type(self.env['hr.holidays.cancel.leave'])
        original = wizard_class.action_cancel_leave
        calls = []

        def revoke(wizard):
            calls.append(wizard.env.uid)
            owner.write({'company_id': self.company_p1.id, 'company_ids': [Command.set(self.company_p1.ids)]})
            return original(wizard)

        with patch.object(wizard_class, 'action_cancel_leave', revoke):
            with self.assertRaises(AccessError):
                self._model('hr.leave.approve').browse(row.id).action_approve(1)
        self.assertEqual(calls, [owner.id])
        self.assertEqual((row.state, self.leaves[self.company_p1.id].state), ('pending', 'validate'))
        self.assertNotIn('webvue_hr.leave.cancellation.owner_authorization', self.env.cr.precommit.data)
