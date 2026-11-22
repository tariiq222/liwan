# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fixture of the approval service tests: no application addon, only this addon's extension points.

The service refuses every call while no application owns its feature, so the case registers the
neutral owner ``False`` (tenant lifecycle only) through ``_operations_feature``, the hook an
application overrides. Roles are custom roles built from this addon's own capabilities.
"""
from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_approval_service.models.access_service import (
    EMPLOYEE_PERMISSIONS,
)

KIND = 'test_kind'
RESOLVER = 'test_resolver'
EMPLOYEE_KEYS = sorted(EMPLOYEE_PERMISSIONS)
REVIEWER_KEYS = sorted(EMPLOYEE_PERMISSIONS | {'operations.requests.review'})
MANAGER_KEYS = sorted(EMPLOYEE_PERMISSIONS | {'operations.monitoring.read', 'operations.processes.manage'})
MONITOR_KEYS = sorted(EMPLOYEE_PERMISSIONS | {'operations.monitoring.read'})

approval_case = tagged('post_install', '-at_install', 'liwan')


@approval_case
class ApprovalCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.company = cls.env.company
        cls.requester = cls._member('apr_requester', cls.company, EMPLOYEE_KEYS)
        cls.manager = cls._member('apr_manager', cls.company, MANAGER_KEYS)
        cls.reviewer = cls._member('apr_reviewer', cls.company, REVIEWER_KEYS)
        cls.reviewer2 = cls._member('apr_reviewer2', cls.company, REVIEWER_KEYS)
        cls.monitor = cls._member('apr_monitor', cls.company, MONITOR_KEYS)
        cls.bystander = cls._member('apr_bystander', cls.company, EMPLOYEE_KEYS)
        # Created here, before setUp narrows the execution kinds: an application that seeds its own process for a new
        # company (liwan_hr does) would be refused under those patches.
        cls.elsewhere = cls.env['res.company'].create({'name': 'Elsewhere'})

    @classmethod
    def _role(cls, company, keys, name):
        permissions = cls.env['liwan.access.permission'].search([('key', 'in', keys)])
        assert len(permissions) == len(keys), 'a capability of the service is not registered'
        return cls.env['liwan.access.role'].with_company(company).create({
            'name_ar': name, 'type': 'custom', 'company_id': company.id,
            'permission_ids': [Command.set(permissions.ids)],
        })

    @classmethod
    def _member(cls, login, company, keys):
        user = new_test_user(cls.env, login=login, name=login, groups='liwan_core.group_employee',
                             company_id=company.id, company_ids=[Command.set([company.id])])
        role = cls._role(company, keys, f'{login} role')
        cls.service._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': company.id}])
        return user

    def setUp(self):
        super().setUp()
        self.resolved = self.reviewer
        self.skippable = False
        self.resolver_capability = 'operations.requests.review'
        self.executed = []
        self.rejected = []
        self.fail_execution = False
        self.real_execution = False
        process_cls = type(self.env['liwan.operation.process'])
        request_cls = type(self.env['liwan.operation.request'])
        original_approved = request_cls._execute_approved
        test = self

        def feature(this, execution_kind):
            return False

        def kinds(this):
            return ({'key': 'approval', 'label': 'Approve'}, {'key': KIND, 'label': 'Test kind'})

        def resolvers(this, execution_kind):
            if execution_kind != KIND:
                return ()
            return ({'key': RESOLVER, 'label': 'Test resolver', 'capability': test.resolver_capability,
                     **({'skip_when_empty': True} if test.skippable else {})},)

        def resolve(this, key):
            return test.resolved

        def approved(this):
            if test.real_execution or this.execution_kind == 'approval':
                return original_approved(this)
            if test.fail_execution:
                message = 'execution failed'
                raise UserError(message)
            test.executed.append(this.id)
            return True

        def rejected(this):
            if test.fail_execution:
                message = 'rejection effect failed'
                raise UserError(message)
            test.rejected.append(this.id)
            return True

        self.patch(process_cls, '_operations_feature', feature)
        self.patch(process_cls, '_operations_execution_kinds', kinds)
        self.patch(process_cls, '_operations_reviewer_resolvers', resolvers)
        self.patch(request_cls, '_operations_resolve_reviewers', resolve)
        self.patch(request_cls, '_execute_approved', approved)
        self.patch(request_cls, '_execute_rejected', rejected)

    def process_as(self, user, company=None):
        return self.env['liwan.operation.process'].with_user(user).with_company(company or self.company)

    def request_as(self, user, company=None):
        return self.env['liwan.operation.request'].with_user(user).with_company(company or self.company)

    def published_process(self, steps=None, *, kind='approval', mode=None, purpose=None, name='Approval', company=None, user=None):
        """A published process configured by a manager; ``steps`` default to one stage of ``self.reviewer``."""
        steps = steps or [{'name': 'Review', 'reviewer_ids': [self.reviewer.id]}]
        process = self.process_as(user or self.manager, company).create({'name': name})
        process.action_configure(0, name, '', kind, steps, purpose=purpose, stage_approval_mode=mode)
        process.action_publish(process.revision)
        return process

    def draft_request(self, process, user=None, name='Request'):
        return self.request_as(user or self.requester, process.company_id).create({'name': name, 'process_id': process.id})

    def pending_request(self, process=None, user=None):
        record = self.draft_request(process or self.published_process(), user)
        record.action_submit(record.revision)
        return record
