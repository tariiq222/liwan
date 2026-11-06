# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextlib import contextmanager
from copy import deepcopy

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .project_constants import OBJECTIVE_COMMAND_MARKER, POLICY_CREATE_MARKER


@contextmanager
def _objective_command_scope(project, commands):
    """Keep the caller's pre-write authorization only for the specified child commands."""
    project.ensure_one()
    project._liwan_check_visible_current()
    project._liwan_check_manage()
    if not project.active:
        raise AccessError(project.env._('Archived projects are read-only.'))
    project.env['liwan.entitlement.service'].require('pmo.enabled')
    Objective = project.env['liwan.project.objective']
    owned_ids = set(project.liwan_objective_ids.ids)
    scope = {'actor_id': project.env.uid, 'project_id': project.id, 'create': [], 'write': [], 'unlink': set()}
    for command in commands:
        if not isinstance(command, (tuple, list)) or len(command) != 3:
            raise ValidationError(project.env._('Objective field is not writable.'))
        operation, record_id, values = command
        if operation == Command.CREATE:
            values = deepcopy(values)
            Objective._liwan_check_values(values)
            if values.get('project_id', project.id) != project.id:
                raise ValidationError(project.env._('Objective project cannot be changed.'))
            values['project_id'] = project.id
            scope['create'].append(values)
        elif operation in (Command.UPDATE, Command.DELETE, Command.UNLINK, Command.LINK):
            if isinstance(record_id, bool) or record_id not in owned_ids:
                raise AccessError(project.env._('Objective project cannot be changed.'))
            if operation == Command.UPDATE:
                values = deepcopy(values)
                Objective._liwan_check_values(values)
                if 'project_id' in values:
                    raise ValidationError(project.env._('Objective project cannot be changed.'))
                scope['write'].append((record_id, values))
            elif operation in (Command.DELETE, Command.UNLINK):
                scope['unlink'].add(record_id)
        elif operation == Command.CLEAR:
            scope['unlink'].update(owned_ids)
        elif operation == Command.SET:
            if not isinstance(values, (tuple, list)):
                raise ValidationError(project.env._('Objective field is not writable.'))
            if any(isinstance(record_id, bool) or record_id not in owned_ids for record_id in values):
                raise AccessError(project.env._('Objective project cannot be changed.'))
            scope['unlink'].update(owned_ids - set(values))
        else:
            raise ValidationError(project.env._('Objective field is not writable.'))
    data = project.env.cr.precommit.data
    previous = data.get(OBJECTIVE_COMMAND_MARKER)
    data[OBJECTIVE_COMMAND_MARKER] = scope
    try:
        yield
    finally:
        if previous is None:
            data.pop(OBJECTIVE_COMMAND_MARKER, None)
        else:
            data[OBJECTIVE_COMMAND_MARKER] = previous


def _consume_objective_scope(records, operation, *, values=None, project=None):
    scope = records.env.cr.precommit.data.get(OBJECTIVE_COMMAND_MARKER)
    if not scope or scope['actor_id'] != records.env.uid:
        return False
    projects = project if project is not None else records.project_id
    if projects.ids != [scope['project_id']]:
        return False
    if operation == 'create':
        if values not in scope['create']:
            return False
        scope['create'].remove(values)
        return True
    if operation == 'write':
        remaining = list(scope['write'])
        for record_id in records.ids:
            command = (record_id, values)
            if command not in remaining:
                return False
            remaining.remove(command)
        scope['write'] = remaining
        return True
    if operation == 'unlink' and set(records.ids) <= scope['unlink']:
        scope['unlink'].difference_update(records.ids)
        return True
    return False


class LiwanOSProjectObjective(models.Model):
    _name = 'liwan.project.objective'
    _inherit = 'liwan.project.child.visibility'
    _description = 'Project objective'
    _liwan_scope = 'company'
    _liwan_allow_archived_projects = True
    _order = 'sequence, id'
    _check_company_auto = True

    project_id = fields.Many2one('project.project', required=True, check_company=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=10)
    goal = fields.Text(required=True)
    metric = fields.Char(default='')
    target = fields.Char(default='')

    def _liwan_check_visible(self):
        for row in self:
            row.project_id._liwan_check_visible_current()
        return self

    def _liwan_check_values(self, vals):
        if set(vals) - {'project_id', 'sequence', 'goal', 'metric', 'target'}:
            msg = self.env._('Objective field is not writable.')
            raise ValidationError(msg)
        for name in ('goal', 'metric', 'target'):
            if name in vals and not isinstance(vals[name], str):
                msg = self.env._('Objective values must be strings.')
                raise ValidationError(msg)
        if 'goal' in vals and not vals['goal'].strip():
            msg = self.env._('An objective needs a non-blank goal.')
            raise ValidationError(msg)

    @api.constrains('goal', 'metric', 'target')
    def _check_objective_text(self):
        for row in self:
            row._liwan_check_values({'goal': row.goal, 'metric': row.metric or '', 'target': row.target or ''})

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._liwan_check_values(vals)
            project = self.env['project.project'].browse(vals.get('project_id')).exists()
            if not project:
                msg = self.env._('A project is required.')
                raise ValidationError(msg)
            policy_create = self.env.su and self.env.cr.precommit.data.get(POLICY_CREATE_MARKER)
            if not policy_create:
                project._liwan_check_visible_current()
                self.env['liwan.entitlement.service'].require('pmo.enabled')
            if not project.active:
                msg = self.env._('Archived projects are read-only.')
                raise ValidationError(msg)
            if not policy_create and not _consume_objective_scope(self, 'create', values=vals, project=project):
                project._liwan_check_manage()
        rows = super().create(vals_list)
        if not self.env.cr.precommit.data.get(POLICY_CREATE_MARKER):
            rows.project_id._liwan_bump_revision()
        return rows

    def _liwan_check_objective_mutation(self, operation, values=None):
        self.check_access('read')
        self._liwan_check_visible()
        for project in self.project_id:
            if not project.active:
                raise AccessError(self.env._('Archived projects are read-only.'))
        self.env['liwan.entitlement.service'].require('pmo.enabled')
        if not _consume_objective_scope(self, operation, values=values):
            for project in self.project_id:
                project._liwan_check_manage()

    def write(self, vals):
        self._liwan_check_values(vals)
        if 'project_id' in vals:
            msg = self.env._('Objective project cannot be changed.')
            raise ValidationError(msg)
        self._liwan_check_objective_mutation('write', vals)
        projects = self.project_id
        for project in projects.sorted('id'):
            project.lock_for_update()
        self.env['liwan.entitlement.service'].require('pmo.enabled')
        result = super().write(vals)
        projects._liwan_bump_revision()
        return result

    def unlink(self):
        self._liwan_check_objective_mutation('unlink')
        projects = self.project_id
        for project in projects.sorted('id'):
            project.lock_for_update()
        self.env['liwan.entitlement.service'].require('pmo.enabled')
        result = super().unlink()
        projects._liwan_bump_revision()
        return result
