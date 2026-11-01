# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestOperationsOwningCompanyAccess(LiwanApiCase):
    """A root manager's child read grant never becomes child management."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.child = cls.env['res.company'].create({'name': 'Operations child', 'parent_id': cls.parent.id})
        cls.member = cls.env['res.company'].create({'name': 'Operations membership only', 'parent_id': cls.parent.id})
        cls.foreign = cls.env['res.company'].create({'name': 'Operations foreign'})
        cls.companies = cls.parent | cls.child | cls.member | cls.foreign
        cls.manager_role = cls.env.ref('liwan_operations.role_operations_manager')
        cls.reviewer_role = cls.env.ref('liwan_operations.role_operations_reviewer')
        cls.employee_role = cls.env.ref('liwan_core.role_employee')
        permission = cls.env['liwan.access.permission'].search([('key', '=', 'operations.requests.read')])
        cls.reader_role = cls.env['liwan.access.role'].create({
            'key': 'operations_branch_reader', 'type': 'built_in', 'name_ar': 'Operations branch reader',
            'permission_ids': [Command.set(permission.ids)],
        })
        cls.manager = cls._user('ops_branch_manager')
        cls.requester = cls._user('ops_branch_requester')
        cls.reviewer = cls._user('ops_branch_reviewer')
        cls.actor = cls._user('ops_branch_mixed')
        cls.child_only = cls._user('ops_branch_only')
        cls.parent_only = cls._user('ops_branch_parent_only')
        cls._assign(cls.manager, [(company, cls.manager_role) for company in cls.companies])
        cls._assign(cls.requester, [(company, cls.employee_role) for company in cls.companies])
        cls._assign(cls.reviewer, [(company, cls.reviewer_role) for company in cls.companies])
        cls._assign(cls.actor, [(cls.parent, cls.manager_role), (cls.child, cls.reader_role)])
        cls._assign(cls.child_only, [(cls.child, cls.reader_role)])
        cls._assign(cls.parent_only, [(cls.parent, cls.manager_role)])
        # Native Odoo caches membership by user id; populate the fixture's full
        # membership from the operator environment before company-local workflow calls.
        for user in (cls.manager, cls.requester, cls.reviewer):
            user._get_company_ids()
        cls.published, cls.drafts, cls.requests, cls.attachments = {}, {}, {}, {}
        for company in cls.companies:
            model = cls.env['liwan.operation.process'].with_user(cls.manager).with_context(allowed_company_ids=[company.id])
            process = model.create({'name': f'Published {company.id}'})
            process.action_configure(0, process.name, 'Process private description', 'approval', [
                {'name': 'Confidential stage', 'reviewer_ids': [cls.reviewer.id]},
            ])
            process.action_publish(1)
            cls.published[company.id] = process
            draft = model.create({'name': f'Unpublished {company.id}'})
            draft.action_configure(0, draft.name, 'Unpublished description', 'approval', [
                {'name': 'Unpublished stage', 'reviewer_ids': [cls.reviewer.id]},
            ])
            cls.drafts[company.id] = draft
            record = cls.env['liwan.operation.request'].with_user(cls.requester).with_context(
                allowed_company_ids=[company.id],
            ).create({'name': f'Private request {company.id}', 'description': 'Private request description', 'process_id': process.id})
            cls.attachments[company.id] = cls.env['ir.attachment'].with_env(record.env).create({
                'name': 'private.txt', 'raw': b'Private request attachment', 'mimetype': 'text/plain',
                'res_model': record._name, 'res_id': record.id, 'type': 'binary',
            })
            record.with_context(active_test=False).action_submit(0)
            cls.requests[company.id] = record

    @classmethod
    def _user(cls, login):
        return new_test_user(cls.env, login=login, password='operations_branch_test_password', groups='base.group_user,base.group_allow_export',
                             company_id=cls.parent.id, company_ids=[Command.set(cls.companies.ids)])

    @classmethod
    def _assign(cls, user, grants):
        assignments = cls.env['liwan.access.assignment']
        assignments.search([('user_id', '=', user.id)]).unlink()
        assignments.create([
            {'user_id': user.id, 'company_id': company.id, 'role_id': role.id}
            for company, role in grants
        ])

    def actor_env(self, user=None, root=None, key='operations.requests.read'):
        return api.Environment(self.env.cr, (user or self.actor).id, {
            'allowed_company_ids': [(root or self.parent).id, self.child.id, self.member.id, self.foreign.id],
            'liwan_capability_scope': (((key,), 'all'),),
        })

    def login(self, user):
        self.authenticate(user.login, 'operations_branch_test_password')

    def test_parent_privilege_cannot_read_private_child_request_or_evidence_orm(self):
        env = self.actor_env()
        record = self.requests[self.child.id].with_env(env)
        self.assertFalse(record.has_access('read'), 'parent monitoring must not expose a private child request')
        with self.assertRaises(AccessError):
            record.read(['description', 'stage_snapshot', 'target_ref'])
        with self.assertRaises(AccessError):
            record.export_data(['description', 'stage_snapshot'])
        event = self.requests[self.child.id].event_ids.with_env(env)
        self.assertFalse(event.has_access('read'))
        with self.assertRaises(AccessError):
            event.read(['comment', 'evidence'])
        attachment = self.attachments[self.child.id].with_env(env)
        self.assertFalse(attachment.has_access('read'))
        with self.assertRaises(AccessError):
            attachment.read(['raw'])

    def test_parent_management_cannot_read_unpublished_child_process_or_steps_orm(self):
        env = self.actor_env()
        draft = self.drafts[self.child.id].with_env(env)
        self.assertFalse(draft.has_access('read'), 'parent management must not expose unpublished child processes')
        with self.assertRaises(AccessError):
            draft.read(['description'])
        steps = self.drafts[self.child.id].step_ids.with_env(env)
        self.assertFalse(steps.has_access('read'))
        with self.assertRaises(AccessError):
            steps.read(['name'])
        self.assertTrue(self.published[self.child.id].with_env(env).has_access('read'))
        self.assertTrue(self.drafts[self.parent.id].with_env(env).has_access('read'))

    def test_http_private_child_detail_and_attachment_are_hidden(self):
        # Exercise real login/HTTP with cold native membership and rule caches.
        self.env.registry.clear_cache()
        self.login(self.actor)
        record = self.requests[self.child.id]
        attachment = self.attachments[self.child.id]
        paths = [f'/api/v1/operations/requests/{record.id}',
                 f'/api/v1/operations/requests/{record.id}/attachments/{attachment.id}/download',
                 f'/api/v1/operations/processes/{self.drafts[self.child.id].id}']
        for path in paths:
            response = self.api('GET', path)
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.json()['code'], 'not_found')
        response = self.api('GET', '/api/v1/operations/processes')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(self.drafts[self.child.id].id, {item['id'] for item in response.json()['items']})
        response = self.api('GET', '/api/v1/operations/requests?scope=monitoring')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(record.id, {item['id'] for item in response.json()['items']})

    def test_child_only_read_role_enters_scoped_routes_without_parent_capability(self):
        # No operator priming of the actor's membership may authorize this request.
        self.env.registry.clear_cache()
        self.login(self.child_only)
        response = self.api('GET', '/api/v1/operations/processes')
        self.assertEqual(response.status_code, 200, response.text)
        # A bridge may seed its own application's process in a new company; this test owns the generic ones.
        self.assertEqual({item['id'] for item in response.json()['items'] if item['execution_kind'] == 'approval'}, {self.published[self.child.id].id})
        response = self.api('GET', f'/api/v1/operations/processes/{self.published[self.child.id].id}')
        self.assertEqual(response.status_code, 200, response.text)
        for company in (self.parent, self.member, self.foreign):
            response = self.api('GET', f'/api/v1/operations/processes/{self.published[company.id].id}')
            self.assertEqual(response.status_code, 404, response.text)
        self.login(self.parent_only)
        response = self.api('GET', f'/api/v1/operations/processes/{self.published[self.child.id].id}')
        self.assertEqual(response.status_code, 404, response.text)

    def test_child_participant_and_actual_child_manager_keep_access(self):
        record = self.requests[self.child.id]
        record.with_env(self.env)._ops_write({'participant_ids': [Command.link(self.actor.id)]})
        env = self.actor_env()
        self.assertEqual(record.with_env(env).read(['description'])[0]['description'], 'Private request description')
        self.assertTrue(record.event_ids.with_env(env).has_access('read'))
        self.assertTrue(self.attachments[self.child.id].with_env(env).has_access('read'))
        self.login(self.actor)
        response = self.api('GET', f'/api/v1/operations/requests/{record.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(any(response.json()['allowed_actions'].values()))
        self._assign(self.actor, [(self.parent, self.manager_role), (self.child, self.manager_role)])
        env = self.actor_env()
        self.assertTrue(self.drafts[self.child.id].with_env(env).has_access('read'))
        self.assertTrue(self.drafts[self.child.id].step_ids.with_env(env).has_access('read'))
        response = self.api('GET', f'/api/v1/operations/processes/{self.drafts[self.child.id].id}')
        self.assertEqual(response.status_code, 200, response.text)
        # A monitor can see nonparticipant requests without becoming a reviewer.
        response = self.api('GET', f'/api/v1/operations/requests/{record.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(any(response.json()['allowed_actions'].values()))

    def test_read_grant_never_borrows_parent_mutation_or_can_flags(self):
        self._assign(self.actor, [(self.parent, self.manager_role), (self.child, self.employee_role)])
        own = self.env['liwan.operation.request'].with_user(self.actor).with_context(
            allowed_company_ids=[self.child.id],
        ).create({'name': 'Own child draft', 'process_id': self.published[self.child.id].id})
        self._assign(self.actor, [(self.parent, self.manager_role), (self.child, self.reader_role)])
        record = own.with_env(self.actor_env())
        self.assertFalse(any(record._operations_allowed_actions().values()), 'parent create must not advertise child edits')
        with self.assertRaises(AccessError):
            record.action_update(0, 'Borrowed parent write', '')
        self.assertFalse(record.has_access('write'))
        self.login(self.actor)
        response = self.api('PATCH', f'/api/v1/operations/requests/{own.id}', json={
            'revision': 0, 'name': 'Borrowed parent write', 'description': '',
        })
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(own.with_env(self.env).name, 'Own child draft')

    def test_isolated_policy_never_becomes_child_local_policy(self):
        self._assign(self.actor, [(self.parent, self.manager_role), (self.child, self.manager_role)])
        self.parent.liwan_branch_access_mode = 'isolated'
        env = self.actor_env()
        self.assertFalse(self.requests[self.child.id].with_env(env).has_access('read'))
        self.assertFalse(self.drafts[self.child.id].with_env(env).has_access('read'))
        self.login(self.actor)
        response = self.api('GET', f'/api/v1/operations/requests/{self.requests[self.child.id].id}')
        self.assertEqual(response.status_code, 404, response.text)

    def test_selected_inherited_management_uses_original_root_and_revokes(self):
        self.parent.liwan_branch_access_mode = 'inherited'
        rule = self.env['liwan.access.branch.rule'].create({
            'company_id': self.parent.id, 'branch_id': self.child.id, 'inherit': True,
            'role_ids': [Command.set(self.manager_role.ids)],
        })
        env = self.actor_env()
        draft = self.drafts[self.child.id].with_env(env)
        record = self.requests[self.child.id].with_env(env)
        steps = self.drafts[self.child.id].step_ids.with_env(env)
        events = self.requests[self.child.id].event_ids.with_env(env)
        attachment = self.attachments[self.child.id].with_env(env)
        for resource in (draft, steps, record, events, attachment):
            self.assertTrue(resource.has_access('read'))
        draft.read(['description'])
        steps.read(['name'])
        record.read(['description', 'stage_snapshot', 'target_ref'])
        events.read(['comment', 'evidence'])
        attachment.read(['raw'])
        rule.inherit = False
        for resource in (draft, steps, record, events, attachment):
            with self.subTest(model=resource._name):
                self.assertFalse(resource.has_access('read'), 'revoked inheritance must restore privacy')
                with self.assertRaises(AccessError):
                    resource.read(['id'])
        rule.inherit = True
        for resource in (draft, steps, record, events, attachment):
            self.assertTrue(resource.has_access('read'), 'new inheritance must not be blocked by stale native rules')

    def test_current_child_manager_and_requester_can_mutate_their_own_company(self):
        env = self.actor_env(self.manager, root=self.child)
        draft = self.drafts[self.child.id].with_env(env)
        self.assertTrue(draft.has_access('read'))
        self.assertTrue(draft.has_access('write'))
        draft.action_publish(draft.revision)
        self.assertEqual(draft.state, 'published')
        requester_env = self.actor_env(self.requester, root=self.child, key='operations.requests.create')
        own = requester_env['liwan.operation.request'].create({
            'name': 'Legitimate child draft', 'process_id': self.published[self.child.id].id,
        })
        self.assertTrue(own._operations_allowed_actions()['edit'])
        own.action_update(0, 'Legitimate child edit', '')
        self.assertEqual(own.name, 'Legitimate child edit')
