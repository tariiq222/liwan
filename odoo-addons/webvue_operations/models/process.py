# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .common import TOKEN, check_revision, require, reviewer_users, text, trusted


class OperationProcess(models.Model):
    _name = 'webvue.operation.process'
    _description = 'Operation process'
    _webvue_scope = 'company'
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
    step_ids = fields.One2many('webvue.operation.process.step', 'process_id')

    @api.model
    def _operations_execution_kinds(self):
        return ('approval',)

    def _operations_targets(self, q):
        return []

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
            vals.update(state='draft', revision=0, company_id=self.env.company.id)
        return super().create(vals_list)

    def write(self, vals):
        if not trusted(self.env):
            self._guard()
            raise AccessError(self.env._('Use the process configuration action.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(self.env._('Archive processes to preserve their history.'))

    def action_configure(self, revision, name, description, execution_kind, steps, *, purpose=None):
        self.ensure_one()
        self._guard()
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        purpose = self.purpose if purpose is None else purpose
        if purpose not in ('work', 'employee'):
            raise ValidationError(self.env._('Choose a valid process purpose.'))
        if execution_kind not in self._operations_execution_kinds():
            raise ValidationError(self.env._('This execution action is not available.'))
        if not isinstance(steps, list) or not 1 <= len(steps) <= 20:
            raise ValidationError(self.env._('Add between one and twenty approval stages.'))
        prepared = []
        for sequence, item in enumerate(steps, 1):
            if not isinstance(item, dict) or set(item) != {'name', 'reviewer_ids'}:
                raise ValidationError(self.env._('Invalid approval stage.'))
            users = reviewer_users(self.env, item['reviewer_ids'])
            prepared.append(Command.create({'name': text(self.env, item['name'], 'stage', 200, True), 'sequence': sequence, 'reviewer_ids': [Command.set(users.ids)], 'company_id': self.company_id.id}))
        process = self.with_context(_operations_write=TOKEN)
        process.step_ids.unlink()
        process.write({'name': text(self.env, name, 'name', 200, True), 'description': text(self.env, description, 'description', 20000), 'execution_kind': execution_kind, 'purpose': purpose, 'step_ids': prepared, 'state': 'draft', 'revision': self.revision + 1})
        return self

    def action_publish(self, revision):
        self.ensure_one()
        self._guard()
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        if self.state != 'draft' or not self.step_ids:
            raise ValidationError(self.env._('Configure the stages before publishing.'))
        definitions = []
        for step in self.step_ids.sorted('sequence'):
            users = reviewer_users(self.env, step.reviewer_ids.ids)
            if any(not self.env['webvue.access.service']._webvue_has_capability(user, 'operations.requests.review', company=self.company_id) for user in users):
                raise ValidationError(self.env._('Every reviewer needs the operations review capability.'))
            definitions.append({
                'name': step.name, 'model_id': self.env['ir.model']._get('webvue.operation.request').id,
                'company_id': self.company_id.id, 'sequence': 100 - step.sequence,
                'review_type': 'individual', 'reviewer_id': users[:1].id,
                'approve_sequence': True, 'approve_sequence_bypass': False,
                'definition_domain': json.dumps([('process_id', '=', self.id), ('process_revision', '=', self.revision)]),
                'operations_process_id': self.id, 'operations_revision': self.revision,
                'operations_reviewer_ids': [Command.set(users.ids)],
            })
        clean = {key: value for key, value in self.env.context.items() if not key.startswith('default_')}
        self.env['tier.definition'].with_context(clean, _operations_write=TOKEN).create(definitions)
        self.with_context(_operations_write=TOKEN).write({'state': 'published'})
        return self

    def action_archive(self, revision):
        self.ensure_one()
        self._guard()
        self.lock_for_update()
        self.invalidate_recordset()
        check_revision(self, revision)
        self.with_context(_operations_write=TOKEN).write({'state': 'archived', 'revision': self.revision + 1})
        return self


class OperationProcessStep(models.Model):
    _name = 'webvue.operation.process.step'
    _description = 'Operation approval stage'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'sequence, id'

    process_id = fields.Many2one('webvue.operation.process', required=True, ondelete='cascade', check_company=True)
    company_id = fields.Many2one('res.company', required=True)
    name = fields.Char(required=True)
    sequence = fields.Integer(required=True)
    reviewer_ids = fields.Many2many('res.users', required=True)

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

    operations_process_id = fields.Many2one('webvue.operation.process', ondelete='restrict', check_company=True)
    operations_revision = fields.Integer()
    operations_reviewer_ids = fields.Many2many('res.users')

    @api.model
    def _get_tier_validation_model_names(self):
        return [*super()._get_tier_validation_model_names(), 'webvue.operation.request']

    @api.model
    def _operations_definition_values(self, vals):
        defaults = self.default_get(['model_id', 'operations_process_id'])
        effective = {**defaults, **vals}
        operation_model = self.env['ir.model']._get('webvue.operation.request')
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
            if any(record.operations_process_id or record.model == 'webvue.operation.request' for record in self) or self._operations_definition_values(vals):
                raise AccessError(self.env._('Published approval definitions are immutable.'))
            if not self.env.user.has_group('base.group_erp_manager'):
                raise AccessError(self.env._('Other approval definitions require their original configuration permission.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            if any(record.operations_process_id or record.model == 'webvue.operation.request' for record in self):
                raise AccessError(self.env._('Approval definitions must be preserved.'))
            if not self.env.user.has_group('base.group_erp_manager'):
                raise AccessError(self.env._('Other approval definitions require their original configuration permission.'))
        return super().unlink()


class OperationsTierReview(models.Model):
    _inherit = 'tier.review'

    def _get_reviewers(self):
        if self.definition_id.operations_process_id:
            users = self.definition_id.operations_reviewer_ids
            document = self.env[self.model].browse(self.res_id)
            return users.filtered(lambda u: u.active and not u.share and document.company_id in u.company_ids and u != document.requester_id)
        return super()._get_reviewers()
