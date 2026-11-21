# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError, ValidationError

from .common import (
    EMPLOYEE_KEYS,
    MANAGER_KEYS,
    MONITOR_KEYS,
    REVIEWER_KEYS,
    ApprovalCase,
)
from odoo.addons.liwan_approval_service.models.access_service import (
    EMPLOYEE_PERMISSIONS,
    PERMISSIONS,
)

REQUEST, PROCESS = 'liwan.operation.request', 'liwan.operation.process'
STEP, EVENT = 'liwan.operation.process.step', 'liwan.operation.event'


class TestCapabilityCatalog(ApprovalCase):

    def test_the_service_owns_its_five_capabilities(self):
        definitions = [d for d in self.service._liwan_capability_definitions() if d['key'] in PERMISSIONS]
        self.assertEqual(sorted(d['key'] for d in definitions), sorted(PERMISSIONS))
        self.assertEqual({d['owner'] for d in definitions}, {'liwan_approval_service'})
        self.assertEqual(len(PERMISSIONS), 5)

    def test_every_capability_but_read_depends_on_read(self):
        dependencies = self.service._liwan_permission_dependencies()
        for key in PERMISSIONS - {'operations.requests.read'}:
            self.assertIn('operations.requests.read', dependencies[key], key)

    def test_the_built_in_employee_role_holds_read_and_create_only(self):
        grants = self.service._liwan_builtin_role_grants()['liwan_core.role_employee']
        self.assertTrue(grants >= EMPLOYEE_PERMISSIONS)
        self.assertFalse(grants & {'operations.requests.review', 'operations.processes.manage', 'operations.monitoring.read'})
        self.assertEqual(EMPLOYEE_PERMISSIONS, {'operations.requests.read', 'operations.requests.create'})

    def test_each_capability_is_a_registered_permission_with_its_group(self):
        permissions = self.env['liwan.access.permission'].search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(set(permissions.mapped('key')), PERMISSIONS)
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('liwan_approval_service.group_cap_operations_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid))
        sensitive = {p.key for p in permissions if p.sensitive}
        self.assertEqual(sensitive, {'operations.requests.review', 'operations.processes.manage'})

    def test_capabilities_follow_the_assigned_role_per_company(self):
        def has(user, key):
            return self.service._liwan_has_capability(user, key, company=self.company)

        for user, keys in ((self.requester, EMPLOYEE_KEYS), (self.reviewer, REVIEWER_KEYS), (self.manager, MANAGER_KEYS), (self.monitor, MONITOR_KEYS)):
            self.assertEqual({key for key in PERMISSIONS if has(user, key)}, set(keys), user.login)
        self.service._liwan_replace_assignments(self.reviewer, [])
        self.assertFalse(has(self.reviewer, 'operations.requests.review'))


class TestModelAccess(ApprovalCase):
    """The ``ir.model.access.csv`` matrix, read as each role through ``has_access``."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = cls._member('apr_reader', cls.company, ['operations.requests.read'])

    def _matrix(self, user, model):
        return tuple(self.env[model].with_user(user).has_access(op) for op in ('read', 'write', 'create', 'unlink'))

    def test_requests(self):
        expected = {
            self.reader: (True, False, False, False), self.requester: (True, True, True, False),
            self.reviewer: (True, True, True, False), self.monitor: (True, True, True, False),
        }
        for user, matrix in expected.items():
            self.assertEqual(self._matrix(user, REQUEST), matrix, user.login)

    def test_processes_and_steps_are_written_only_by_managers(self):
        for user in (self.reader, self.requester, self.reviewer, self.monitor):
            self.assertEqual(self._matrix(user, PROCESS), (True, False, False, False), user.login)
            self.assertEqual(self._matrix(user, STEP), (True, False, False, False), user.login)
        self.assertEqual(self._matrix(self.manager, PROCESS), (True, True, True, False))
        self.assertEqual(self._matrix(self.manager, STEP), (True, True, True, True))

    def test_nothing_is_readable_without_the_read_capability(self):
        nobody = self._member('apr_nobody', self.company, ['operations.requests.read'])
        self.service._liwan_replace_assignments(nobody, [])
        for model in (REQUEST, PROCESS, STEP, EVENT):
            self.assertFalse(self.env[model].with_user(nobody).has_access('read'), model)

    def test_audit_events_are_readable_but_never_writable_or_deletable(self):
        for user in (self.requester, self.reviewer, self.manager):
            self.assertEqual(self._matrix(user, EVENT), (True, False, True, False), user.login)

    def test_tier_definitions_are_managed_with_the_manage_capability(self):
        self.assertTrue(self.env['tier.definition'].with_user(self.manager).has_access('create'))
        self.assertFalse(self.env['tier.definition'].with_user(self.requester).has_access('create'))


class TestRecordVisibility(ApprovalCase):

    def setUp(self):
        super().setUp()
        self.published = self.published_process(name='Published')
        self.draft = self.process_as(self.manager).create({'name': 'Draft'})
        self.mine = self.draft_request(self.published, name='Mine')
        self.submitted = self.pending_request(self.published)
        self.other_requester = self._member('apr_requester2', self.company, EMPLOYEE_KEYS)
        self.theirs = self.draft_request(self.published, self.other_requester, name='Theirs')

    # An application may seed records of its own kind in the company; only the fixture's kind is compared.
    OWN_KIND = {
        PROCESS: ('execution_kind', '=', 'approval'), STEP: ('process_id.execution_kind', '=', 'approval'),
        REQUEST: ('execution_kind', '=', 'approval'), EVENT: ('request_id.execution_kind', '=', 'approval'),
    }

    def _ids(self, model, user):
        return set(self.env[model].with_user(user).search([self.OWN_KIND[model]]).ids)

    def test_an_employee_sees_published_processes_and_their_stages_only(self):
        for user in (self.requester, self.reviewer, self.bystander):
            self.assertEqual(self._ids(PROCESS, user), {self.published.id}, user.login)
            self.assertEqual(self._ids(STEP, user), set(self.published.step_ids.ids), user.login)

    def test_a_manager_also_sees_drafts_and_archived_processes(self):
        archived = self.published_process(name='Old')
        archived.action_archive(archived.revision)
        self.assertEqual(self._ids(PROCESS, self.manager), {self.published.id, self.draft.id, archived.id})
        with self.assertRaises(AccessError):
            self.draft.with_user(self.requester).read(['name'])

    def test_requests_are_visible_to_their_requester_and_participants_only(self):
        self.assertEqual(self._ids(REQUEST, self.requester), {self.mine.id, self.submitted.id})
        self.assertEqual(self._ids(REQUEST, self.other_requester), {self.theirs.id})
        self.assertEqual(self._ids(REQUEST, self.reviewer), {self.submitted.id})
        self.assertEqual(self._ids(REQUEST, self.bystander), set())
        with self.assertRaises(AccessError):
            self.mine.with_user(self.bystander).read(['name'])

    def test_the_monitoring_capability_shows_every_request_of_the_company_and_revocation_is_immediate(self):
        everything = {self.mine.id, self.submitted.id, self.theirs.id}
        self.assertEqual(self._ids(REQUEST, self.monitor), everything)
        self.assertEqual(self._ids(EVENT, self.monitor), set(self.submitted.event_ids.ids))
        self.service._liwan_replace_assignments(self.monitor, [{'role_id': self._role(self.company, ['operations.requests.read'], 'Plain monitor').id, 'company_id': self.company.id}])
        self.assertEqual(self._ids(REQUEST, self.monitor), set())

    def test_events_follow_their_request(self):
        self.assertEqual(self._ids(EVENT, self.requester), set(self.submitted.event_ids.ids))
        self.assertEqual(self._ids(EVENT, self.reviewer), set(self.submitted.event_ids.ids))
        self.assertEqual(self._ids(EVENT, self.bystander), set())


class TestCompanyScoping(ApprovalCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.other = cls.env['res.company'].create({'name': 'Second company'})
        cls.other_manager = cls._member('apr_other_manager', cls.other, MANAGER_KEYS)
        cls.other_reviewer = cls._member('apr_other_reviewer', cls.other, REVIEWER_KEYS)
        cls.other_requester = cls._member('apr_other_requester', cls.other, EMPLOYEE_KEYS)

    def _other_process(self):
        return self.published_process([{'name': 'Review', 'reviewer_ids': [self.other_reviewer.id]}], company=self.other, user=self.other_manager, name='Theirs')

    def test_every_record_belongs_to_the_company_it_was_made_in(self):
        process = self._other_process()
        record = self.pending_request(process, self.other_requester)
        self.assertEqual({process.company_id, process.step_ids.company_id, record.company_id, record.event_ids.company_id}, {self.other})

    def test_another_company_sees_none_of_the_records_even_as_manager_and_monitor(self):
        process = self._other_process()
        record = self.pending_request(process, self.other_requester)
        for model, found in ((PROCESS, process), (STEP, process.step_ids), (REQUEST, record), (EVENT, record.event_ids)):
            for user in (self.manager, self.monitor):
                self.assertFalse(self.env[model].with_user(user).search([('id', 'in', found.ids)]), (model, user.login))
                with self.assertRaises(AccessError):
                    found.with_user(user).read(['company_id'])

    def test_a_process_of_another_company_cannot_be_used_or_changed(self):
        process = self._other_process()
        with self.assertRaisesRegex(ValidationError, 'published process'):
            self.request_as(self.requester).create({'name': 'R', 'process_id': process.id})
        for action in (lambda: process.with_user(self.manager).action_archive(process.revision),
                       lambda: process.with_user(self.manager).action_configure(process.revision, 'X', '', 'approval', [{'name': 'S', 'reviewer_ids': [self.reviewer.id]}])):
            with self.assertRaises(AccessError):
                action()
        self.assertEqual(process.state, 'published')

    def test_a_reviewer_of_the_other_company_cannot_decide_this_companys_request(self):
        record = self.pending_request()
        for user in (self.other_reviewer, self.other_manager):
            with self.assertRaises(AccessError):
                record.with_user(user).with_company(self.other).action_approve(record.revision)
        self.assertEqual(record.state, 'pending')

    def test_a_member_of_both_companies_cannot_act_on_a_request_from_the_other_one(self):
        record = self.pending_request()
        dual = self.reviewer
        dual.company_ids = [Command.link(self.other.id)]
        with self.assertRaises(AccessError):
            record.with_user(dual).with_company(self.other).action_approve(record.revision)
        record.with_user(dual).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_named_reviewer_of_another_company_is_refused_when_configuring(self):
        process = self.process_as(self.manager).create({'name': 'Cross'})
        with self.assertRaises(ValidationError):
            process.action_configure(0, 'Cross', '', 'approval', [{'name': 'S', 'reviewer_ids': [self.other_reviewer.id]}])


class TestAttachmentsAndDefinitions(ApprovalCase):

    def _attach(self, user, record, **extra):
        return self.env['ir.attachment'].with_user(user).create({'name': 'file.txt', 'raw': b'data', 'res_model': REQUEST, 'res_id': record.id, **extra})

    def test_the_requester_attaches_to_an_open_draft(self):
        record = self.draft_request(self.published_process())
        attachment = self._attach(self.requester, record)
        self.assertEqual((attachment.res_model, attachment.res_id), (REQUEST, record.id))
        attachment.with_user(self.requester).unlink()
        self.assertFalse(attachment.exists())

    def test_nobody_else_attaches_and_attachments_are_never_public(self):
        record = self.draft_request(self.published_process())
        for user in (self.bystander, self.reviewer, self.manager):
            with self.assertRaises(AccessError):
                self._attach(user, record)
        with self.assertRaisesRegex(AccessError, 'cannot be public'):
            self._attach(self.requester, record, public=True)

    def test_a_pending_request_is_frozen_for_attachments(self):
        draft = self.draft_request(self.published_process())
        attachment = self._attach(self.requester, draft)
        draft.action_submit(draft.revision)
        with self.assertRaises(AccessError):
            self._attach(self.requester, draft)
        with self.assertRaises(AccessError):
            attachment.with_user(self.requester).unlink()
        with self.assertRaises(AccessError):
            attachment.with_user(self.requester).write({'res_id': 0})
        self.assertTrue(attachment.exists())

    def test_an_attachment_cannot_be_moved_onto_a_request_or_to_a_missing_one(self):
        record = self.draft_request(self.published_process())
        loose = self.env['ir.attachment'].with_user(self.bystander).create({'name': 'loose', 'raw': b'x'})
        with self.assertRaises(AccessError):
            loose.write({'res_model': REQUEST, 'res_id': record.id})
        with self.assertRaisesRegex(AccessError, 'does not exist'):
            self._attach(self.requester, record.browse(999999999))

    def test_published_definitions_are_immutable_and_preserved(self):
        process = self.published_process()
        definition = self.env['tier.definition'].search([('operations_process_id', '=', process.id)])
        self.assertTrue(definition)
        for user in (self.manager, self.requester):
            with self.assertRaisesRegex(AccessError, 'immutable'):
                definition.with_user(user).write({'name': 'Changed'})
            with self.assertRaisesRegex(AccessError, 'preserved'):
                definition.with_user(user).unlink()

    def test_definitions_for_the_request_model_cannot_be_created_by_hand(self):
        model = self.env['ir.model']._get(REQUEST)
        process = self.published_process()
        for vals in ({'operations_process_id': process.id}, {'model_id': model.id}, {'operations_revision': 3}):
            with self.assertRaises(AccessError, msg=repr(vals)):
                self.env['tier.definition'].with_user(self.manager).create({'name': 'Forged', 'model_id': model.id, **vals})

    def test_a_definition_for_a_stock_model_needs_the_stock_configuration_permission(self):
        stock = self.env['ir.model']._get('res.partner')
        with self.assertRaisesRegex(AccessError, 'original configuration permission'):
            self.env['tier.definition'].with_user(self.manager).create({'name': 'Partner', 'model_id': stock.id})
