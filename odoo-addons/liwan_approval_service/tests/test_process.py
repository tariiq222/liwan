# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError, ValidationError

from .common import KIND, RESOLVER, ApprovalCase
from odoo.addons.liwan_approval_service.models.common import TOKEN
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


class TestProcessLifecycle(ApprovalCase):

    def _draft(self, name='Draft process'):
        return self.process_as(self.manager).create({'name': name})

    def test_create_forces_a_draft_at_revision_zero_in_the_current_company(self):
        process = self.process_as(self.manager).create({'name': '  Leave  '})
        self.assertEqual((process.name, process.state, process.revision, process.company_id), ('Leave', 'draft', 0, self.company))
        self.assertEqual((process.purpose, process.stage_approval_mode, process.execution_kind), ('work', 'per_stage', 'approval'))

    def test_create_refuses_control_fields_and_other_companies(self):
        for vals in ({'name': 'A', 'state': 'published'}, {'name': 'A', 'revision': 5}, {'name': 'A', 'stage_approval_mode': 'single'}):
            with self.assertRaises(AccessError):
                self.process_as(self.manager).create(vals)
        other = self.elsewhere
        with self.assertRaises(AccessError):
            self.process_as(self.manager).create({'name': 'A', 'company_id': other.id})

    def test_create_validates_the_name(self):
        for name in ('', '   ', None, 'x' * 201):
            with self.assertRaises(ValidationError):
                self.process_as(self.manager).create({'name': name})

    def test_a_user_without_the_manage_capability_cannot_create_or_configure(self):
        with self.assertRaises(AccessError):
            self.process_as(self.requester).create({'name': 'Nope'})
        process = self._draft()
        for user in (self.requester, self.reviewer, self.monitor):
            with self.assertRaises(AccessError):
                process.with_user(user).action_configure(0, 'N', '', 'approval', [{'name': 'S', 'reviewer_ids': [self.reviewer.id]}])

    def test_the_orm_cannot_write_or_unlink_a_process_directly(self):
        process = self.published_process()
        with self.assertRaises(AccessError):
            process.with_user(self.manager).write({'name': 'Renamed'})
        with self.assertRaises(AccessError):
            process.with_user(self.manager).unlink()
        with self.assertRaises(AccessError):
            process.unlink()
        self.assertEqual(process.name, 'Approval')

    def test_the_process_cannot_be_driven_for_another_company(self):
        other = self.elsewhere
        process = self._draft()
        self.manager.company_ids = [Command.link(other.id)]
        with self.assertRaises(AccessError):
            process.with_user(self.manager).with_company(other).action_publish(0)
        self.assertEqual(process.revision, 0)

    def test_configure_replaces_the_stages_and_bumps_the_revision(self):
        process = self._draft()
        process.action_configure(0, 'Spend', 'Details', 'approval', [
            {'name': 'First', 'reviewer_ids': [self.reviewer.id]},
            {'name': 'Second', 'reviewer_ids': [self.reviewer.id, self.reviewer2.id]},
        ], purpose='employee', stage_approval_mode='single')
        self.assertEqual((process.revision, process.name, process.description, process.purpose, process.stage_approval_mode), (1, 'Spend', 'Details', 'employee', 'single'))
        steps = process.step_ids.sorted('sequence')
        self.assertEqual([(s.sequence, s.name, s.reviewer_ids) for s in steps], [(1, 'First', self.reviewer), (2, 'Second', self.reviewer | self.reviewer2)])
        process.action_configure(1, 'Spend', '', 'approval', [{'name': 'Only', 'reviewer_ids': [self.reviewer2.id]}])
        self.assertEqual((process.revision, process.purpose, process.stage_approval_mode), (2, 'employee', 'single'))
        self.assertEqual(process.step_ids.mapped('name'), ['Only'])

    def test_configure_refuses_a_stale_or_malformed_revision_with_a_conflict(self):
        process = self._draft()
        for revision in (1, -1, True, '0', None):
            with self.assertRaises(LiwanAccessRule) as caught:
                process.action_configure(revision, 'S', '', 'approval', [{'name': 'S', 'reviewer_ids': [self.reviewer.id]}])
            self.assertEqual((caught.exception.code, caught.exception.status), ('conflict', 409))

    def test_configure_validates_stage_count_shape_and_options(self):
        process = self._draft()
        good = {'name': 'S', 'reviewer_ids': [self.reviewer.id]}
        bad = [
            ('approval', [], None, None), ('approval', [good] * 21, None, None), ('approval', 'steps', None, None),
            ('approval', [{'reviewer_ids': [self.reviewer.id]}], None, None),
            ('approval', [{**good, 'extra': 1}], None, None), ('approval', ['S'], None, None),
            ('approval', [{**good, 'name': ' '}], None, None),
            ('approval', [good], 'nope', None), ('approval', [good], None, 'nope'), ('unknown_kind', [good], None, None),
        ]
        for kind, steps, purpose, mode in bad:
            with self.assertRaises(ValidationError, msg=repr((kind, steps, purpose, mode))):
                process.action_configure(0, 'S', '', kind, steps, purpose=purpose, stage_approval_mode=mode)
        self.assertEqual((process.revision, process.step_ids), (0, self.env['liwan.operation.process.step']))
        process.action_configure(0, 'S', '', 'approval', [good] * 20)
        self.assertEqual(len(process.step_ids), 20)

    def test_named_reviewers_must_be_active_internal_users_of_the_company(self):
        process = self._draft()
        outsider = self._member('apr_outsider', self.elsewhere, ['operations.requests.read'])
        portal = self.env['res.users'].create({'name': 'Portal', 'login': 'apr_portal', 'group_ids': [Command.link(self.env.ref('base.group_portal').id)]})
        gone = self._member('apr_gone', self.company, ['operations.requests.read'])
        gone.active = False
        for ids in ([], None, [0], [True], ['1'], [self.reviewer.id, 999999999], [outsider.id], [portal.id], [gone.id], list(range(1, 22))):
            with self.assertRaises(ValidationError, msg=repr(ids)):
                process.action_configure(0, 'S', '', 'approval', [{'name': 'S', 'reviewer_ids': ids}])

    def test_a_stage_uses_named_reviewers_or_a_resolver_never_both(self):
        process = self._draft()
        for step in ({'name': 'S', 'reviewer_ids': [self.reviewer.id], 'resolver': RESOLVER}, {'name': 'S', 'resolver': 'unknown'}, {'name': 'S', 'resolver': 5}):
            with self.assertRaises(ValidationError):
                process.action_configure(0, 'S', '', KIND, [step])
        process.action_configure(0, 'S', '', KIND, [{'name': 'S', 'resolver': RESOLVER}])
        self.assertEqual((process.step_ids.reviewer_resolver, process.step_ids.reviewer_ids), (RESOLVER, self.env['res.users']))

    def test_a_resolver_belongs_to_its_execution_kind(self):
        process = self._draft()
        with self.assertRaises(ValidationError):
            process.action_configure(0, 'S', '', 'approval', [{'name': 'S', 'resolver': RESOLVER}])

    def test_the_step_constraint_rejects_neither_and_both(self):
        process = self._draft()
        steps = self.env['liwan.operation.process.step'].with_context(_operations_write=TOKEN)
        for vals in ({'reviewer_ids': []}, {'reviewer_ids': [Command.set([self.reviewer.id])], 'reviewer_resolver': RESOLVER}):
            with self.assertRaises(ValidationError), self.env.cr.savepoint():
                steps.create({'process_id': process.id, 'company_id': self.company.id, 'name': 'S', 'sequence': 1, **vals})

    def test_steps_cannot_be_written_outside_the_configure_action(self):
        process = self.published_process()
        step = process.step_ids
        for user in (self.manager, self.requester):
            with self.assertRaises(AccessError):
                step.with_user(user).write({'name': 'Renamed'})
            with self.assertRaises(AccessError):
                step.with_user(user).unlink()
            with self.assertRaises(AccessError):
                self.env['liwan.operation.process.step'].with_user(user).create({'process_id': process.id, 'company_id': self.company.id, 'name': 'S', 'sequence': 9, 'reviewer_ids': [Command.set([self.reviewer.id])]})

    def test_publish_needs_stages_and_creates_one_definition_per_stage(self):
        process = self._draft()
        with self.assertRaisesRegex(ValidationError, 'Configure the stages'):
            process.action_publish(0)
        process.action_configure(0, 'S', '', 'approval', [{'name': 'One', 'reviewer_ids': [self.reviewer.id]}, {'name': 'Two', 'reviewer_ids': [self.reviewer2.id]}])
        process.action_publish(1)
        self.assertEqual((process.state, process.revision), ('published', 1))
        definitions = self.env['tier.definition'].search([('operations_process_id', '=', process.id)], order='sequence desc')
        self.assertEqual([(d.name, d.operations_revision, d.operations_reviewer_ids) for d in definitions], [('One', 1, self.reviewer), ('Two', 1, self.reviewer2)])

    def test_publish_refuses_a_stale_revision_and_a_second_publication(self):
        process = self._draft()
        process.action_configure(0, 'S', '', 'approval', [{'name': 'One', 'reviewer_ids': [self.reviewer.id]}])
        with self.assertRaises(LiwanAccessRule) as caught:
            process.action_publish(0)
        self.assertEqual(caught.exception.status, 409)
        process.action_publish(1)
        with self.assertRaisesRegex(ValidationError, 'Configure the stages'):
            process.action_publish(1)

    def test_publish_refuses_a_reviewer_who_lost_the_review_capability(self):
        process = self._draft()
        process.action_configure(0, 'S', '', 'approval', [{'name': 'One', 'reviewer_ids': [self.reviewer.id, self.bystander.id]}])
        with self.assertRaises(LiwanAccessRule) as caught:
            process.action_publish(1)
        self.assertEqual(caught.exception.code, 'reviewer_not_eligible')
        self.assertEqual(process.state, 'draft')

    def test_a_published_process_can_be_reconfigured_back_to_a_draft_revision(self):
        process = self.published_process()
        process.action_configure(1, 'Approval', '', 'approval', [{'name': 'Other', 'reviewer_ids': [self.reviewer2.id]}])
        self.assertEqual((process.state, process.revision), ('draft', 2))
        process.action_publish(2)
        revisions = self.env['tier.definition'].search([('operations_process_id', '=', process.id)]).mapped('operations_revision')
        self.assertEqual(sorted(revisions), [1, 2])

    def test_archive_is_terminal_and_keeps_the_history(self):
        process = self.published_process()
        process.action_archive(1)
        self.assertEqual((process.state, process.revision), ('archived', 2))
        with self.assertRaisesRegex(ValidationError, 'already archived'):
            process.action_archive(2)
        with self.assertRaisesRegex(ValidationError, 'archived process cannot be changed'):
            process.action_configure(2, 'S', '', 'approval', [{'name': 'S', 'reviewer_ids': [self.reviewer.id]}])
        with self.assertRaises(ValidationError):
            process.action_publish(2)
        with self.assertRaises(LiwanAccessRule):
            self.published_process().action_archive(0)
        self.assertTrue(self.env['tier.definition'].search([('operations_process_id', '=', process.id)]))

    def test_a_requester_cannot_archive_or_publish(self):
        process = self.published_process()
        for action in (lambda: process.with_user(self.requester).action_archive(1), lambda: process.with_user(self.requester).action_publish(1)):
            with self.assertRaises(AccessError):
                action()

    def test_seed_publishes_a_process_for_the_operator_only(self):
        steps = [{'name': 'Seeded', 'reviewer_ids': [self.reviewer.id]}]
        Process = self.env['liwan.operation.process']
        with self.assertRaisesRegex(AccessError, 'installation operator'):
            Process.with_user(self.manager)._operations_seed(self.company, {'name': 'Seed'}, steps)
        process = Process._operations_seed(self.company, {'name': 'Seed'}, steps)
        self.assertEqual((process.state, process.revision, process.company_id, process.step_ids.name), ('published', 1, self.company, 'Seeded'))

    def test_the_execution_kinds_and_stage_capabilities_follow_the_registered_extensions(self):
        Process = self.env['liwan.operation.process']
        self.assertEqual(Process._operations_execution_kind_keys(), ('approval', KIND))
        self.resolver_capability = 'operations.monitoring.read'
        self.assertEqual(Process._operations_stage_capabilities(), ('operations.requests.read', 'operations.requests.review', 'operations.monitoring.read'))
        self.assertEqual(Process._operations_reviewer_resolver(KIND, RESOLVER)['key'], RESOLVER)
        self.assertIsNone(Process._operations_reviewer_resolver('approval', RESOLVER))

    def test_an_unowned_feature_refuses_every_process_write(self):
        self.patch(type(self.env['liwan.operation.process']), '_operations_feature', lambda this, kind: None)
        with self.assertRaisesRegex(AccessError, 'No installed application'):
            self.process_as(self.manager).create({'name': 'Orphan'})
