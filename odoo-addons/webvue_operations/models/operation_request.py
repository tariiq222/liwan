# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .common import STAGE_APPROVAL_MODES, TOKEN, check_revision, require, text, trusted
from .notification_types import DECISION_KINDS, REVIEW_REQUESTED
from odoo.addons.base_tier_validation.models.workflow_security import (
    _DOCUMENT_WRITE_TOKEN,
)


class OperationExecutionError(UserError):
    """The decision savepoint was rolled back; HTTP may retain only its failure audit."""


class OperationRequest(models.Model):
    _name = 'webvue.operation.request'
    _inherit = ['mail.thread', 'tier.validation']
    _description = 'Operation request'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'id desc'
    _tier_validation_manual_config = True
    _state_from = ['draft', 'returned']
    _state_to = ['done']
    _cancel_state = 'withdrawn'

    name = fields.Char(required=True)
    description = fields.Text(default='')
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company, index=True)
    process_id = fields.Many2one('webvue.operation.process', required=True, ondelete='restrict', check_company=True)
    process_name = fields.Char(readonly=True)
    process_revision = fields.Integer(readonly=True, default=0)
    purpose = fields.Selection(
        [('work', 'Work'), ('employee', 'Employee affairs')],
        default='work', required=True, readonly=True, index=True,
    )
    state = fields.Selection([(v, v.title()) for v in ('draft', 'pending', 'returned', 'rejected', 'withdrawn', 'done')], default='draft', required=True)
    revision = fields.Integer(default=0, readonly=True)
    cycle = fields.Integer(default=0, readonly=True)
    requester_id = fields.Many2one('res.users', required=True, default=lambda self: self.env.user, readonly=True)
    participant_ids = fields.Many2many('res.users', readonly=True)
    stage_snapshot = fields.Json(default=list, readonly=True)
    # Snapshotted with the stages at each submission, so a pending request keeps the mode it was submitted under.
    stage_approval_mode = fields.Selection(STAGE_APPROVAL_MODES, default='per_stage', required=True, readonly=True)
    execution_kind = fields.Char(default='approval', readonly=True)
    execution_count = fields.Integer(default=0, readonly=True)
    event_ids = fields.One2many('webvue.operation.event', 'request_id', readonly=True)
    target_ref = fields.Json(readonly=True)

    @api.model
    def _operations_target_values(self, process, target_id):
        if target_id:
            raise ValidationError(self.env._('This process does not accept a linked record.'))
        return {'target_ref': False}

    def _operations_prepare_submission(self, process):
        return True

    def _operations_target(self):
        return None

    @api.model_create_multi
    def create(self, vals_list):
        require(self.env, 'operations.requests.create')
        prepared = []
        for source in vals_list:
            vals = dict(source)
            if set(vals) - {'name', 'description', 'process_id', 'company_id', 'target_id'}:
                raise AccessError(self.env._('Request control fields cannot be supplied.'))
            process = self.env['webvue.operation.process'].browse(vals.get('process_id')).exists()
            if not process or process.company_id != self.env.company or process.state != 'published':
                raise ValidationError(self.env._('Choose a published process from the current company.'))
            process.check_access('read')
            target = self._operations_target_values(process, vals.pop('target_id', None))
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(self.env._('Use the current company.'))
            vals.update(name=text(self.env, vals.get('name'), 'name', 200, True), description=text(self.env, vals.get('description', ''), 'description', 20000), company_id=self.env.company.id, state='draft', requester_id=self.env.uid, revision=0, cycle=0, process_revision=0, participant_ids=[], stage_snapshot=[], stage_approval_mode='per_stage', execution_count=0, execution_kind='approval', process_name=process.name, event_ids=[])
            # Classification belongs to this request, including returned/resubmitted
            # cycles; later process edits must never move its historical purpose.
            vals.update(target, purpose=process.purpose)
            prepared.append(vals)
        clean = {k: v for k, v in self.env.context.items() if not k.startswith('default_') and k not in {'_operations_write', 'skip_validation_check', '_tier_review_workflow'}}
        return super(OperationRequest, self.with_context(clean)).create(prepared).with_env(self.env)

    def write(self, vals):
        if not trusted(self.env):
            self.ensure_one()
            self.lock_for_update(allow_referencing=True)
            self.invalidate_recordset()
            self._editable()
            if set(vals) - {'name', 'description'}:
                raise AccessError(self.env._('Use an operations transition.'))
            vals = {k: text(self.env, v, k, 200 if k == 'name' else 20000, k == 'name') for k, v in vals.items()}
            vals['revision'] = self.revision + 1
            return self._ops_write(vals)
        return super().write(vals)

    def unlink(self):
        raise AccessError(self.env._('Withdraw requests to preserve their history.'))

    def _ops_write(self, vals):
        return self.with_context(_operations_write=TOKEN, skip_validation_check=_DOCUMENT_WRITE_TOKEN).write(vals)

    def _guard(self, key):
        self.ensure_one()
        require(self.env, key)
        self.check_access('read')
        if self.company_id != self.env.company or not self.env.user.active:
            raise AccessError(self.env._('Use an active account in the current company.'))

    def _editable(self):
        self._guard('operations.requests.create')
        if self.requester_id != self.env.user or self.state not in ('draft', 'returned'):
            raise AccessError(self.env._('Only the requester can edit an open draft.'))

    def _event(self, kind, comment=''):
        clean = {key: value for key, value in self.env.context.items() if not key.startswith('default_')}
        return self.env['webvue.operation.event'].with_context(clean, _operations_write=TOKEN).create({'request_id': self.id, 'company_id': self.company_id.id, 'kind': kind, 'comment': comment, 'actor_id': self.env.uid, 'cycle': self.cycle, 'evidence': {'process_revision': self.process_revision, 'stages': self.stage_snapshot or [], 'review_statuses': [{'sequence': r.sequence, 'status': r.status} for r in self.review_ids.sorted('sequence')], 'execution_count': self.execution_count}})

    def action_update(self, revision, name, description):
        self._editable()
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        self.write({'name': name, 'description': description})
        return self

    def action_submit(self, revision):
        self._editable()
        with self.env.cr.savepoint():
            self._tier_lock('write')
            check_revision(self, revision)
            process = self.process_id
            process.lock_for_update()
            process.invalidate_recordset()
            if process.state != 'published' or process.company_id != self.company_id:
                raise ValidationError(self.env._('The process must be published before submission.'))
            self._operations_prepare_submission(process)
            definitions = self.env['tier.definition'].search([('operations_process_id', '=', process.id), ('operations_revision', '=', process.revision)], order='sequence desc')
            if not definitions:
                raise ValidationError(self.env._('The process has no approval stages.'))
            snapshot = []
            participants = self.requester_id
            for sequence, definition in enumerate(definitions, 1):
                users = definition.operations_reviewer_ids.filtered(lambda u: u.active and not u.share and self.company_id in u.company_ids and u != self.requester_id)
                users = users.filtered(lambda u: self.env['webvue.access.service']._webvue_has_capability(u, 'operations.requests.review', company=self.company_id))
                if not users:
                    raise ValidationError(self.env._('A stage has no eligible reviewer other than the requester.'))
                participants |= users
                snapshot.append({'sequence': sequence, 'name': definition.name, 'reviewer_ids': users.ids})
            if self.review_ids:
                super().restart_validation()
            self._ops_write({'process_revision': process.revision, 'process_name': process.name, 'execution_kind': process.execution_kind, 'participant_ids': [Command.set(participants.ids)], 'stage_snapshot': snapshot, 'stage_approval_mode': process.stage_approval_mode, 'cycle': self.cycle + 1})
            super().request_validation()
            if len(self.review_ids) != len(snapshot):
                raise ValidationError(self.env._('The configured approval stages could not be created.'))
            self._ops_write({'state': 'pending', 'revision': self.revision + 1})
            self._event('submitted')
        self._notify_current_reviewers()
        return self

    def _notify_current_reviewers(self):
        """Bell row for the reviewers of the stage the request now waits at.

        The actor is never among them: the requester is excluded from every stage at submission, and a
        reviewer's approval also passes any later stage that lists the same reviewer.
        """
        self.ensure_one()
        open_reviews = self.review_ids.filtered(lambda r: r.status in ('pending', 'waiting')).sorted('sequence')
        if not open_reviews:
            return
        sequence = open_reviews[0].sequence
        reviewers = self.env['res.users'].browse(self.stage_snapshot[sequence - 1]['reviewer_ids'])
        service = self.env['webvue.notify.service']
        for reviewer in reviewers:
            service._webvue_deliver(
                self._name, self.id, REVIEW_REQUESTED, reviewer.partner_id,
                self.env._('%(actor)s asked for your review of %(name)s', actor=self.env.user.name, name=self.name),
                key=f'{REVIEW_REQUESTED}:{self.id}:{self.cycle}:{sequence}:{reviewer.partner_id.id}',
                values={'subject': self.name},
            )

    def _notify_requester(self):
        """Bell row for the requester once the request is approved, rejected or returned."""
        self.ensure_one()
        kind = DECISION_KINDS[self.state]
        if self.requester_id == self.env.user:
            return
        self.env['webvue.notify.service']._webvue_deliver(
            self._name, self.id, kind, self.requester_id.partner_id,
            self.env._('%(actor)s decided your request %(name)s', actor=self.env.user.name, name=self.name),
            key=f'{kind}:{self.id}:{self.cycle}:{self.requester_id.partner_id.id}',
            values={'subject': self.name},
        )

    def _decision_guard(self, revision):
        self._guard('operations.requests.review')
        self._tier_lock()
        check_revision(self, revision)
        if self.state != 'pending' or self.requester_id == self.env.user:
            raise AccessError(self.env._('This request is not available for your decision.'))
        # Snapshot membership is necessary; current capability/company/active checks are above.
        eligible = self._tier_eligible_reviews(self.review_ids)
        eligible = eligible.filtered(lambda r: self.env.uid in (self.stage_snapshot[r.sequence - 1]['reviewer_ids'] if 0 < r.sequence <= len(self.stage_snapshot) else []))
        if not eligible:
            raise AccessError(self.env._('Only the current stage reviewer can decide this request.'))
        return eligible

    def _execute_approved(self):
        if self.execution_kind != 'approval':
            raise UserError(self.env._('This execution action is not available.'))
        return True

    def action_approve(self, revision, comment=''):
        self.ensure_one()
        require(self.env, 'operations.requests.review')
        try:
            with self.env.cr.savepoint():
                reviews = self._decision_guard(revision)
                if self.stage_approval_mode == 'per_stage':
                    # Only the current stage; a reviewer of the next stage decides it separately.
                    reviews = reviews.sorted('sequence')[:1]
                super()._validate_tier(reviews)
                self.review_ids._update_review_status()
                self._event('approved', text(self.env, comment, 'comment', 4000))
                if self.validation_status == 'validated':
                    # Claim inside the same locked savepoint before invoking the private hook.
                    self._ops_write({'execution_count': self.execution_count + 1})
                    try:
                        self._execute_approved()
                    except (UserError, ValidationError, AccessError) as exc:
                        raise OperationExecutionError(str(exc)) from exc
                    self._ops_write({'state': 'done'})
                    self._event('executed')
                self._ops_write({'revision': self.revision + 1})
        except OperationExecutionError:
            self.invalidate_recordset()
            self._event('execution_failed', self.env._('Execution failed; the last approval was rolled back.'))
            raise
        if self.state == 'pending':
            self._notify_current_reviewers()
        else:
            self._notify_requester()
        return self

    def _negative_decision(self, revision, comment, state):
        with self.env.cr.savepoint():
            reviews = self._decision_guard(revision)
            note = text(self.env, comment, 'comment', 4000, True)
            super()._rejected_tier(reviews)
            self._ops_write({'state': state, 'revision': self.revision + 1})
            self._event(state, note)
        self._notify_requester()
        return self

    def action_reject(self, revision, comment):
        return self._negative_decision(revision, comment, 'rejected')

    def action_return(self, revision, comment):
        return self._negative_decision(revision, comment, 'returned')

    def action_withdraw(self, revision, comment=''):
        self._guard('operations.requests.create')
        with self.env.cr.savepoint():
            self._tier_lock('write')
            check_revision(self, revision)
            if self.requester_id != self.env.user or self.state not in ('draft', 'pending', 'returned'):
                raise AccessError(self.env._('Only the requester can withdraw an open request.'))
            self._ops_write({'state': 'withdrawn', 'revision': self.revision + 1})
            self._event('withdrawn', text(self.env, comment, 'comment', 4000))
        return self

    # The generic engine RPC buttons cannot bypass the WebVue capability/revision flow.
    def request_validation(self):
        raise AccessError(self.env._('Use the operations submit action.'))

    def validate_tier(self):
        raise AccessError(self.env._('Use the operations approve action.'))

    def reject_tier(self):
        raise AccessError(self.env._('Use the operations reject action.'))

    def restart_validation(self):
        raise AccessError(self.env._('Use the operations resubmission action.'))

    def _validate_tier(self, tiers=False):
        raise AccessError(self.env._('Use the operations approve action.'))

    def _rejected_tier(self, tiers=False):
        raise AccessError(self.env._('Use the operations reject action.'))

    def _allow_to_remove_reviews(self, values):
        # OCA's documented workflow hook clears reviews on return/cancel. WebVue
        # keeps the current cycle's evidence until explicit resubmission; its
        # immutable event log retains every previous decision across cycles.
        return False

    def _operations_allowed_actions(self):
        self.ensure_one()
        service = self.env['webvue.access.service']
        writable = self.company_id == self.env.company and self.env['webvue.entitlement.service']._webvue_feature_write('operations.enabled') and self.env.user.active
        creator = writable and self.requester_id == self.env.user and service._webvue_has_capability(self.env.user, 'operations.requests.create', record=self)
        reviewer = writable and self.state == 'pending' and self.requester_id != self.env.user and service._webvue_has_capability(self.env.user, 'operations.requests.review', record=self) and bool(self._tier_eligible_reviews(self.review_ids))
        editable = creator and self.state in ('draft', 'returned')
        return {'edit': bool(editable), 'submit': bool(editable), 'approve': bool(reviewer), 'reject': bool(reviewer), 'return': bool(reviewer), 'withdraw': bool(creator and self.state in ('draft', 'returned', 'pending'))}


class OperationEvent(models.Model):
    _name = 'webvue.operation.event'
    _description = 'Operation audit event'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'id'

    request_id = fields.Many2one('webvue.operation.request', required=True, ondelete='restrict', check_company=True)
    company_id = fields.Many2one('res.company', required=True)
    kind = fields.Char(required=True)
    comment = fields.Text(default='')
    actor_id = fields.Many2one('res.users', required=True)
    cycle = fields.Integer(required=True)
    evidence = fields.Json(readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        if not trusted(self.env):
            raise AccessError(self.env._('Audit evidence is server controlled.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Audit evidence is immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Audit evidence must be preserved.'))
