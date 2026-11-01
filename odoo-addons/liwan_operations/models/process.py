# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .common import (
    STAGE_APPROVAL_MODES,
    TOKEN,
    check_revision,
    require,
    reviewer_users,
    text,
    trusted,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


class OperationProcess(models.Model):
    _name = 'liwan.operation.process'
    _description = 'Operation process'
    _liwan_scope = 'company'
    _check_company_auto = True
    _order = 'name, id'

    name = fields.Char(required=True)
    description = fields.Text(default='')
    company_id = fields.Many2one('res.company', required=True, default=lambda self: self.env.company, index=True)
    state = fields.Selection([('draft', 'Draft'), ('published', 'Published'), ('archived', 'Archived')], default='draft', required=True)
    revision = fields.Integer(default=0, readonly=True, copy=False)
    execution_kind = fields.Char(default='approval', required=True)
    purpose = fields.Selection(
        [('work', 'Work'), ('employee', 'Employee affairs')],
        default='work', required=True, index=True,
    )
    stage_approval_mode = fields.Selection(STAGE_APPROVAL_MODES, default='per_stage', required=True)
    step_ids = fields.One2many('liwan.operation.process.step', 'process_id')

    @api.model
    def _operations_execution_kinds(self):
        return ('approval',)

    def _operations_targets(self, q):
        return []

    @api.model
    def _operations_reviewer_resolvers(self, execution_kind):
        """Resolvers a stage of ``execution_kind`` may use instead of named users.

        Each entry is ``{'key', 'label', 'capability'}``; ``capability`` is what the resolved
        reviewers must hold in the request's company, because the resolver itself is the authorization.
        An entry may add ``'skip_when_empty': True``: a stage with no eligible reviewer is then skipped
        at submission instead of refusing it.
        """
        return ()

    @api.model
    def _operations_reviewer_resolver(self, execution_kind, key):
        return next((entry for entry in self._operations_reviewer_resolvers(execution_kind) if entry['key'] == key), None)

    @api.model
    def _operations_application_kinds(self):
        """Execution kinds whose own application creates the requests, never the self-service forms."""
        return ()

    def _guard(self):
        require(self.env, 'operations.processes.manage')
        self.check_access('write')
        if any(p.company_id != self.env.company for p in self):
            raise AccessError(self.env._('Use the current company.'))

    @api.model_create_multi
    def create(self, vals_list):
        require(self.env, 'operations.processes.manage')
        for vals in vals_list:
            if not trusted(self.env) and set(vals) - {'name', 'description', 'execution_kind', 'purpose', 'company_id'}:
                raise AccessError(self.env._('Process control fields cannot be supplied.'))
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(self.env._('Use the current company.'))
            if not trusted(self.env):
                vals['name'] = text(self.env, vals.get('name'), 'name', 200, True)
            vals.update(state='draft', revision=0, company_id=self.env.company.id)
        return super().create(vals_list)

    def write(self, vals):
        if not trusted(self.env):
            self._guard()
            raise AccessError(self.env._('Use the process configuration action.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(self.env._('Archive processes to preserve their history.'))

    def action_configure(self, revision, name, description, execution_kind, steps, *, purpose=None, stage_approval_mode=None):
        self.ensure_one()
        self._guard()
        return self._configure(revision, name, description, execution_kind, steps, purpose=purpose, stage_approval_mode=stage_approval_mode)

    def _prepare_step(self, sequence, item, execution_kind):
        if not isinstance(item, dict) or 'name' not in item or set(item) - {'name', 'reviewer_ids', 'resolver'}:
            raise ValidationError(self.env._('Invalid approval stage.'))
        resolver = item.get('resolver')
        if resolver is None:
            users = reviewer_users(self.env, item.get('reviewer_ids'))
        else:
            if item.get('reviewer_ids'):
                raise ValidationError(self.env._('A stage uses named reviewers or a resolver, not both.'))
            if not isinstance(resolver, str) or not self._operations_reviewer_resolver(execution_kind, resolver):
                raise ValidationError(self.env._('This reviewer resolver is not available.'))
            users = self.env['res.users']
        return Command.create({'name': text(self.env, item['name'], 'stage', 200, True), 'sequence': sequence, 'reviewer_ids': [Command.set(users.ids)], 'reviewer_resolver': resolver, 'company_id': self.company_id.id})

    def _configure(self, revision, name, description, execution_kind, steps, *, purpose=None, stage_approval_mode=None):
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        if self.state == 'archived':
            raise ValidationError(self.env._('An archived process cannot be changed.'))
        purpose = self.purpose if purpose is None else purpose
        if purpose not in ('work', 'employee'):
            raise ValidationError(self.env._('Choose a valid process purpose.'))
        stage_approval_mode = self.stage_approval_mode if stage_approval_mode is None else stage_approval_mode
        if stage_approval_mode not in dict(STAGE_APPROVAL_MODES):
            raise ValidationError(self.env._('Choose a valid stage approval mode.'))
        if execution_kind not in self._operations_execution_kinds():
            raise ValidationError(self.env._('This execution action is not available.'))
        if not isinstance(steps, list) or not 1 <= len(steps) <= 20:
            raise ValidationError(self.env._('Add between one and twenty approval stages.'))
        prepared = [self._prepare_step(sequence, item, execution_kind) for sequence, item in enumerate(steps, 1)]
        process = self.with_context(_operations_write=TOKEN)
        process.step_ids.unlink()
        process.write({'name': text(self.env, name, 'name', 200, True), 'description': text(self.env, description, 'description', 20000), 'execution_kind': execution_kind, 'purpose': purpose, 'stage_approval_mode': stage_approval_mode, 'step_ids': prepared, 'state': 'draft', 'revision': self.revision + 1})
        return self

    def _ineligible_reviewers(self, users):
        service = self.env['liwan.access.service']
        return users.filtered(lambda user: not service._liwan_has_capability(user, 'operations.requests.review', company=self.company_id))

    def action_publish(self, revision):
        self.ensure_one()
        self._guard()
        return self._publish(revision)

    def _publish(self, revision):
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        if self.state != 'draft' or not self.step_ids:
            raise ValidationError(self.env._('Configure the stages before publishing.'))
        definitions = []
        for step in self.step_ids.sorted('sequence'):
            if step.reviewer_resolver:
                if not self._operations_reviewer_resolver(self.execution_kind, step.reviewer_resolver):
                    raise ValidationError(self.env._('This reviewer resolver is not available.'))
                users = self.env['res.users']
            else:
                users = reviewer_users(self.env, step.reviewer_ids.ids)
                if self._ineligible_reviewers(users):
                    code = 'reviewer_not_eligible'
                    raise LiwanAccessRule(code, self.env._('Every reviewer needs the operations review capability.'), field='steps')
            definitions.append({
                'name': step.name, 'model_id': self.env['ir.model']._get('liwan.operation.request').id,
                'company_id': self.company_id.id, 'sequence': 100 - step.sequence,
                'review_type': 'individual', 'reviewer_id': users[:1].id,
                'approve_sequence': True, 'approve_sequence_bypass': False,
                'definition_domain': json.dumps([('process_id', '=', self.id), ('process_revision', '=', self.revision)]),
                'operations_process_id': self.id, 'operations_revision': self.revision,
                'operations_reviewer_ids': [Command.set(users.ids)],
                'operations_reviewer_resolver': step.reviewer_resolver,
            })
        clean = {key: value for key, value in self.env.context.items() if not key.startswith('default_')}
        self.env['tier.definition'].with_context(clean, _operations_write=TOKEN).create(definitions)
        self.with_context(_operations_write=TOKEN).write({'state': 'published'})
        return self

    @api.model
    def _operations_seed(self, company, vals, steps):
        """Create, configure and publish a process for ``company`` without the capability check.

        Only the install or migration operator may call it: it needs the superuser environment it was
        given and never elevates one itself.
        """
        if not self.env.su:
            raise AccessError(self.env._('Seeding a process needs the installation operator.'))
        seeder = self.with_company(company).with_context(_operations_write=TOKEN)
        process = super(OperationProcess, seeder).create([{**vals, 'state': 'draft', 'revision': 0, 'company_id': company.id}])
        process._configure(0, process.name, process.description or '', process.execution_kind, steps)
        process._publish(1)
        return process

    def action_archive(self, revision):
        self.ensure_one()
        self._guard()
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        if self.state == 'archived':
            raise ValidationError(self.env._('This process is already archived.'))
        self.with_context(_operations_write=TOKEN).write({'state': 'archived', 'revision': self.revision + 1})
        return self


class OperationProcessStep(models.Model):
    _name = 'liwan.operation.process.step'
    _description = 'Operation approval stage'
    _liwan_scope = 'company'
    _check_company_auto = True
    _order = 'sequence, id'

    process_id = fields.Many2one('liwan.operation.process', required=True, ondelete='cascade', check_company=True)
    company_id = fields.Many2one('res.company', required=True)
    name = fields.Char(required=True)
    sequence = fields.Integer(required=True)
    reviewer_ids = fields.Many2many('res.users')
    # Empty for named reviewers; otherwise a key of ``process._operations_reviewer_resolvers``.
    reviewer_resolver = fields.Char()

    @api.constrains('reviewer_resolver', 'reviewer_ids')
    def _check_reviewers_or_resolver(self):
        for step in self:
            if bool(step.reviewer_resolver) == bool(step.reviewer_ids):
                raise ValidationError(self.env._('A stage needs named reviewers or a resolver, never both and never neither.'))

    @api.model_create_multi
    def create(self, vals_list):
        if not trusted(self.env):
            raise AccessError(self.env._('Use the process configuration action.'))
        return super().create(vals_list)

    def write(self, vals):
        if not trusted(self.env):
            raise AccessError(self.env._('Use the process configuration action.'))
        return super().write(vals)

    def unlink(self):
        if not trusted(self.env):
            raise AccessError(self.env._('Use the process configuration action.'))
        return super().unlink()


class OperationsTierDefinition(models.Model):
    _inherit = 'tier.definition'

    operations_process_id = fields.Many2one('liwan.operation.process', ondelete='restrict', check_company=True)
    operations_revision = fields.Integer()
    operations_reviewer_ids = fields.Many2many('res.users')
    operations_reviewer_resolver = fields.Char()

    @api.model
    def _get_tier_validation_model_names(self):
        return [*super()._get_tier_validation_model_names(), 'liwan.operation.request']

    @api.model
    def _operations_definition_values(self, vals):
        defaults = self.default_get(['model_id', 'operations_process_id'])
        effective = {**defaults, **vals}
        operation_model = self.env['ir.model']._get('liwan.operation.request')
        return bool(effective.get('operations_process_id') or effective.get('model_id') == operation_model.id or 'model' in vals or 'default_model' in self.env.context or any(key.startswith('operations_') for key in vals) or any(key.startswith('default_operations_') for key in self.env.context))

    @api.model_create_multi
    def create(self, vals_list):
        if not trusted(self.env):
            if any(self._operations_definition_values(vals) for vals in vals_list):
                raise AccessError(self.env._('Approval definitions are controlled by process publication.'))
            if not self.env.user.has_group('base.group_erp_manager'):
                raise AccessError(self.env._('Other approval definitions require their original configuration permission.'))
        return super().create(vals_list)

    def write(self, vals):
        if not trusted(self.env):
            if any(record.operations_process_id or record.model == 'liwan.operation.request' for record in self) or self._operations_definition_values(vals):
                raise AccessError(self.env._('Published approval definitions are immutable.'))
            if not self.env.user.has_group('base.group_erp_manager'):
                raise AccessError(self.env._('Other approval definitions require their original configuration permission.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            if any(record.operations_process_id or record.model == 'liwan.operation.request' for record in self):
                raise AccessError(self.env._('Approval definitions must be preserved.'))
            if not self.env.user.has_group('base.group_erp_manager'):
                raise AccessError(self.env._('Other approval definitions require their original configuration permission.'))
        return super().unlink()


class OperationsTierReview(models.Model):
    _inherit = 'tier.review'

    def _get_reviewers(self):
        if self.definition_id.operations_process_id:
            document = self.env[self.model].browse(self.res_id)
            users = self.env['res.users'].browse(document.stage_snapshot[self.sequence - 1]['reviewer_ids'])
            return users.filtered(lambda u: u.active and not u.share and document.company_id in u.company_ids and u != document.requester_id)
        return super()._get_reviewers()
