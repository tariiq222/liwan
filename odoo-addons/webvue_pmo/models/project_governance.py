# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import date, datetime

from psycopg2.errors import ForeignKeyViolation, UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.fields import Domain

GOVERNANCE_ROLES = ('R', 'A', 'C', 'I')
REGISTER_KINDS = ('risk', 'issue')
REGISTER_PRIORITIES = ('low', 'normal', 'high', 'critical')
REGISTER_STATUSES = ('open', 'in_progress', 'resolved', 'closed')


class StakeholderAssignmentError(UserError):
    """A stakeholder cannot be removed while it is used by a RACI row."""


def _check_project(project, manage=False):
    if not project or not project.exists():
        msg = "A valid project is required."
        raise ValidationError(msg)
    if not project.active or project.company_id != project.env.company:
        msg = "The project is outside the active company or archived."
        raise AccessError(msg)
    project._webvue_check_visible_current()
    if manage:
        project._webvue_check_manage()
    return project


def _check_internal_user(user, project):
    if not user:
        return
    # Query membership as the caller instead of materializing company_ids:
    # its active-company conversion reads foreign res.company records.
    valid = user.env['res.users'].search_count([
        ('id', '=', user.id), ('share', '=', False), ('active', '=', True),
        ('company_ids', 'in', [project.env.company.id]),
    ])
    if not valid:
        msg = "The internal user must be active and belong to the current company."
        raise ValidationError(msg)


def _check_inputs(model, values, writable):
    unknown = set(values) - writable
    if unknown:
        raise ValidationError("Governance field is not writable: %s" % sorted(unknown)[0])
    for key in model.env.context:
        if key.startswith('default_') and key[8:] not in writable:
            raise ValidationError("Governance default is not writable: %s" % key[8:])


def _create_values(model, vals_list, writable):
    for values in vals_list:
        _check_inputs(model, values, writable)
    defaults = model.default_get(list(writable))
    return [dict(defaults, **values) for values in vals_list]


def _date_only(value):
    if value is False or value is None:
        return False
    if type(value) is date:
        return value
    if isinstance(value, datetime) or not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        msg = "Due date must be a calendar date in YYYY-MM-DD format."
        raise ValidationError(msg)
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        msg = "Due date must be a real calendar date."
        raise ValidationError(msg) from error


STAKEHOLDER_WRITABLE = {'project_id', 'name', 'user_id', 'organization', 'role', 'contact', 'notes'}
RACI_WRITABLE = {'project_id', 'task_id', 'stakeholder_id', 'role'}
REGISTER_WRITABLE = {'project_id', 'kind', 'title', 'description', 'priority', 'status', 'owner_id', 'due_date', 'response', 'task_id', 'probability', 'impact'}


class GovernanceVisibility(models.AbstractModel):
    _name = 'webvue.governance.visibility'
    _description = 'Caller-scoped governance visibility'
    _webvue_governance_task_mode = None

    def _webvue_visibility_domain(self):
        # Odoo evaluates ir.rule domains with sudo, including relational `any`.
        # Build the related queries in the original caller environment instead.
        # Query objects remain SQL subqueries; no ids or environments are cached.
        projects = self.env['project.project']._search([
            ('active', '=', True), ('company_id', '=', self.env.company.id),
        ])
        domain = Domain('project_id', 'in', projects)
        if self._webvue_governance_task_mode:
            try:
                tasks = self.env['project.task']._search([
                    ('active', '=', True), ('company_id', '=', self.env.company.id),
                    ('project_id.active', '=', True),
                ])
                task_domain = Domain('task_id', 'in', tasks)
            except AccessError:
                task_domain = Domain.FALSE
            if self._webvue_governance_task_mode == 'optional':
                task_domain |= Domain('task_id', '=', False)
            domain &= task_domain
        return domain

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, *, active_test=True, bypass_access=False):
        if not self.env.su:
            domain = Domain(domain) & self._webvue_visibility_domain()
        return super()._search(domain, offset=offset, limit=limit, order=order, active_test=active_test, bypass_access=bypass_access)

    def _check_access(self, operation):
        denied = super()._check_access(operation)
        if denied or self.env.su or not any(self._ids):
            return denied
        # This hook also protects field fetch/read, has_access and cached rows.
        # The empty-record ACL check inside _search does not recurse here.
        visible = self.browse(self._search([('id', 'in', self.ids)]))
        forbidden = self - visible
        if forbidden:
            return forbidden, lambda: AccessError("Governance records require readable active current-company projects and tasks.")
        return None


class ProjectStakeholder(models.Model):
    _name = 'webvue.project.stakeholder'
    _inherit = 'webvue.governance.visibility'
    _description = 'Project stakeholder'
    _webvue_scope = 'company'
    _order = 'name, id'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    name = fields.Char(required=True)
    user_id = fields.Many2one('res.users', ondelete='set null', index=True)
    organization = fields.Char(default='')
    role = fields.Char(default='')
    contact = fields.Char(default='')
    notes = fields.Text(default='')

    def _webvue_check_visible(self):
        for record in self:
            _check_project(record.project_id)
        return self

    def _webvue_check_manage(self):
        self.check_access('read')
        self._webvue_check_visible()
        for record in self:
            _check_project(record.project_id, manage=True)
        return self

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = _create_values(self, vals_list, STAKEHOLDER_WRITABLE)
        for vals in vals_list:
            project = _check_project(self.env['project.project'].browse(vals.get('project_id')), manage=True)
            if not vals.get('name') or not str(vals['name']).strip():
                msg = "Stakeholder name is required."
                raise ValidationError(msg)
            _check_internal_user(self.env['res.users'].browse(vals.get('user_id')), project)
            vals['name'] = str(vals['name']).strip()
        return super().create(vals_list)

    def write(self, vals):
        _check_inputs(self, vals, STAKEHOLDER_WRITABLE)
        if 'project_id' in vals:
            msg = "Stakeholder project cannot be changed."
            raise ValidationError(msg)
        for record in self:
            record._webvue_check_manage()
            if 'name' in vals and (not vals['name'] or not str(vals['name']).strip()):
                msg = "Stakeholder name is required."
                raise ValidationError(msg)
            if 'user_id' in vals:
                _check_internal_user(record.env['res.users'].browse(vals['user_id']), record.project_id)
        values = dict(vals)
        if 'name' in values:
            values['name'] = str(values['name']).strip()
        return super().write(values)

    def unlink(self):
        self._webvue_check_manage()
        for record in self:
            if self.env['webvue.project.raci'].search_count([('stakeholder_id', '=', record.id)]):
                msg = "Remove this stakeholder's RACI assignments first."
                raise StakeholderAssignmentError(msg)
        try:
            with self.env.cr.savepoint():
                return super().unlink()
        except ForeignKeyViolation as error:
            if error.diag.constraint_name != 'webvue_project_raci_stakeholder_id_fkey':
                raise
            msg = "Remove this stakeholder's RACI assignments first."
            raise StakeholderAssignmentError(msg) from error


class ProjectRaci(models.Model):
    _name = 'webvue.project.raci'
    _inherit = 'webvue.governance.visibility'
    _webvue_governance_task_mode = 'required'
    _description = 'Project RACI assignment'
    _webvue_scope = 'company'
    _order = 'task_id, stakeholder_id, id'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    task_id = fields.Many2one('project.task', required=True, ondelete='cascade', index=True)
    stakeholder_id = fields.Many2one('webvue.project.stakeholder', required=True, ondelete='restrict', index=True)
    role = fields.Selection([(value, value) for value in GOVERNANCE_ROLES], required=True)
    accountable_task_id = fields.Many2one('project.task', compute='_compute_accountable_task', store=True, index=True)

    _raci_pair_uniq = models.Constraint(
        'UNIQUE(task_id, stakeholder_id)',
        'A stakeholder may have only one RACI row per task.',
    )
    _raci_one_accountable = models.Constraint(
        'UNIQUE(accountable_task_id)',
        'A task may have only one accountable stakeholder.',
    )

    _raci_authoritative_accountable = models.UniqueIndex(
        "(task_id) WHERE role = 'A'",
        'A task may have only one accountable stakeholder.',
    )

    @api.depends('task_id', 'role')
    def _compute_accountable_task(self):
        for record in self:
            record.accountable_task_id = record.task_id if record.role == 'A' else False

    def _webvue_check_visible(self, require_task=True):
        for record in self:
            project = _check_project(record.project_id)
            if record.stakeholder_id.project_id != project:
                msg = "The stakeholder does not belong to this project."
                raise AccessError(msg)
            if require_task:
                if record.task_id.project_id != project:
                    msg = "The task does not belong to this project."
                    raise AccessError(msg)
                record.task_id._webvue_check_visible_current()
        return self

    def _webvue_check_manage(self):
        self.check_access('read')
        self._webvue_check_visible()
        for record in self:
            _check_project(record.project_id, manage=True)
        return self

    def _validate_links(self, vals, current=None):
        project_id = vals.get('project_id', current.project_id.id if current else None)
        task_id = vals.get('task_id', current.task_id.id if current else None)
        stakeholder_id = vals.get('stakeholder_id', current.stakeholder_id.id if current else None)
        project = _check_project(self.env['project.project'].browse(project_id), manage=True)
        task = self.env['project.task'].search([
            ('id', '=', task_id), ('project_id', '=', project.id),
            ('active', '=', True), ('project_id.active', '=', True),
            ('company_id', '=', self.env.company.id),
        ], limit=1)
        stakeholder = self.env['webvue.project.stakeholder'].search([
            ('id', '=', stakeholder_id), ('project_id', '=', project.id),
        ], limit=1)
        if not task or not stakeholder:
            msg = "RACI task and stakeholder must belong to the same readable project."
            raise ValidationError(msg)
        task._webvue_check_visible_current()
        stakeholder._webvue_check_visible()
        role = vals.get('role', current.role if current else None)
        if role not in GOVERNANCE_ROLES:
            msg = "RACI role must be R, A, C or I."
            raise ValidationError(msg)
        return project

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = _create_values(self, vals_list, RACI_WRITABLE)
        for vals in vals_list:
            if not vals.get('role'):
                msg = "RACI role is required."
                raise ValidationError(msg)
            self._validate_links(vals)
        try:
            with self.env.cr.savepoint():
                rows = super().create(vals_list)
                rows.flush_recordset()
                return rows
        except UniqueViolation as error:
            msg = "Each task/stakeholder pair must be unique and each task permits only one A."
            raise ValidationError(msg) from error

    def write(self, vals):
        _check_inputs(self, vals, RACI_WRITABLE)
        if 'project_id' in vals:
            msg = "RACI project cannot be changed."
            raise ValidationError(msg)
        for record in self:
            record._webvue_check_manage()
            record._validate_links(vals, current=record)
        try:
            with self.env.cr.savepoint():
                result = super().write(vals)
                self.flush_recordset()
                return result
        except UniqueViolation as error:
            msg = "Each task/stakeholder pair must be unique and each task permits only one A."
            raise ValidationError(msg) from error

    def unlink(self):
        self._webvue_check_manage()
        return super().unlink()


class ProjectRegister(models.Model):
    _name = 'webvue.project.register'
    _inherit = 'webvue.governance.visibility'
    _webvue_governance_task_mode = 'optional'
    _description = 'Project risk and issue register item'
    _webvue_scope = 'company'
    _order = 'priority, due_date, id'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    kind = fields.Selection([('risk', 'Risk'), ('issue', 'Issue')], required=True, index=True)
    title = fields.Char(required=True)
    description = fields.Text(default='')
    priority = fields.Selection([(value, value.title()) for value in REGISTER_PRIORITIES], required=True, default='normal', index=True)
    status = fields.Selection([(value, value.replace('_', ' ').title()) for value in REGISTER_STATUSES], required=True, default='open', index=True)
    owner_id = fields.Many2one('res.users', ondelete='set null', index=True)
    due_date = fields.Date()
    response = fields.Text(default='')
    task_id = fields.Many2one('project.task', ondelete='set null', index=True)
    probability = fields.Integer()
    impact = fields.Integer()
    score = fields.Integer(compute='_compute_score', store=True)

    @api.depends('probability', 'impact', 'kind')
    def _compute_score(self):
        for record in self:
            record.score = record.probability * record.impact if record.kind == 'risk' else 0

    def _webvue_check_visible(self):
        for record in self:
            _check_project(record.project_id)
        return self

    def _webvue_check_manage(self):
        self.check_access('read')
        self._webvue_check_visible()
        for record in self:
            _check_project(record.project_id, manage=True)
        return self

    def _validate_values(self, vals, current=None):
        project = _check_project(self.env['project.project'].browse(vals.get('project_id', current.project_id.id if current else None)), manage=True)
        kind = vals.get('kind', current.kind if current else None)
        if current and 'kind' in vals and vals['kind'] != current.kind:
            msg = "Register item kind cannot be changed."
            raise ValidationError(msg)
        if kind not in REGISTER_KINDS:
            msg = "Register kind must be risk or issue."
            raise ValidationError(msg)
        title = vals.get('title', current.title if current else '')
        if not isinstance(title, str) or not title.strip():
            msg = "Register title is required."
            raise ValidationError(msg)
        priority = vals.get('priority', current.priority if current else 'normal')
        status = vals.get('status', current.status if current else 'open')
        if priority not in REGISTER_PRIORITIES or status not in REGISTER_STATUSES:
            msg = "Register priority or status is invalid."
            raise ValidationError(msg)
        for field_name in ('probability', 'impact'):
            value = vals.get(field_name, getattr(current, field_name, None))
            if kind == 'risk' and (not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > 5):
                msg = "Risk probability and impact must be between 1 and 5."
                raise ValidationError(msg)
            if kind == 'issue' and value not in (None, False, 0):
                msg = "Issues cannot have probability or impact."
                raise ValidationError(msg)
        if 'due_date' in vals:
            _date_only(vals['due_date'])
        owner_id = vals.get('owner_id', current.owner_id.id if current and current.owner_id else None)
        _check_internal_user(self.env['res.users'].browse(owner_id), project)
        task_id = vals.get('task_id', current.task_id.id if current and current.task_id else None)
        if task_id:
            task = self.env['project.task'].search([
                ('id', '=', task_id), ('project_id', '=', project.id), ('active', '=', True),
                ('project_id.active', '=', True), ('company_id', '=', self.env.company.id),
            ], limit=1)
            if not task:
                msg = "The register task must belong to the same readable project."
                raise ValidationError(msg)
            task._webvue_check_visible_current()
        return project

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = _create_values(self, vals_list, REGISTER_WRITABLE)
        for vals in vals_list:
            self._validate_values(vals)
            vals['title'] = vals['title'].strip()
            if 'due_date' in vals:
                vals['due_date'] = _date_only(vals['due_date'])
            if vals.get('kind') == 'issue':
                vals.update(probability=False, impact=False)
        return super().create(vals_list)

    def write(self, vals):
        _check_inputs(self, vals, REGISTER_WRITABLE)
        if 'project_id' in vals:
            msg = "Register project cannot be changed."
            raise ValidationError(msg)
        for record in self:
            record._webvue_check_manage()
            self._validate_values(vals, current=record)
        values = dict(vals)
        if 'title' in values:
            values['title'] = values['title'].strip()
        if 'due_date' in values:
            values['due_date'] = _date_only(values['due_date'])
        return super().write(values)

    def unlink(self):
        self._webvue_check_manage()
        return super().unlink()
