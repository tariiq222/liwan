# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .project_constants import POLICY_CREATE_MARKER


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
            if not (self.env.su and self.env.cr.precommit.data.get(POLICY_CREATE_MARKER)):
                project._liwan_check_visible_current()
                project._liwan_check_manage()
                self.env['liwan.entitlement.service'].require('pmo.enabled')
            if not project.active:
                msg = self.env._('Archived projects are read-only.')
                raise ValidationError(msg)
        rows = super().create(vals_list)
        if not self.env.cr.precommit.data.get(POLICY_CREATE_MARKER):
            rows.project_id._liwan_bump_revision()
        return rows

    def write(self, vals):
        self._liwan_check_values(vals)
        if 'project_id' in vals:
            msg = self.env._('Objective project cannot be changed.')
            raise ValidationError(msg)
        self._liwan_check_manage()
        projects = self.project_id
        for project in projects.sorted('id'):
            project.lock_for_update()
        self.env['liwan.entitlement.service'].require('pmo.enabled')
        result = super().write(vals)
        projects._liwan_bump_revision()
        return result

    def unlink(self):
        self._liwan_check_manage()
        projects = self.project_id
        for project in projects.sorted('id'):
            project.lock_for_update()
        self.env['liwan.entitlement.service'].require('pmo.enabled')
        result = super().unlink()
        projects._liwan_bump_revision()
        return result
