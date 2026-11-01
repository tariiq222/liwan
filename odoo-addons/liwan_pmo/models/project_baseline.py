# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Schedule and cost baselines: numbered, immutable snapshots of the plan the manager froze.

A baseline is created whole by ``create`` (the project manager, after the checks below) and never
changed or deleted afterwards: a new plan is a new number. Nothing is added to ``project.project``;
the current baseline of a project is its highest number. The rows are written in the caller's own
environment, without ``sudo()``: ``create`` builds every value on the server and the task lines accept
only the baseline that is creating them.
"""
from odoo import api, fields, models
from odoo.exceptions import AccessError, LockError, UserError, ValidationError

from .project_charter import LiwanChangeRequired, LiwanCharterState
from .project_constants import BASELINE_NOTE_MAX, TASK_CANCELED_STATE
from .project_governance import _check_project, _create_values

BASELINE_CREATE_FIELDS = {'project_id', 'note', 'change_id'}
BASELINE_LINE_MARKER = 'liwan_pmo.baseline_lines'
# A change request that may cover a baseline: approved, or already implemented.
CHANGE_COVERING_STATES = ('approved', 'implemented')


class LiwanBaselineBusy(UserError):
    """Another baseline is being taken on the project."""


class LiwanProjectBaseline(models.Model):
    _name = 'liwan.project.baseline'
    _inherit = 'liwan.governance.visibility'
    _description = 'Project schedule and cost baseline'
    _liwan_scope = 'company'
    _order = 'number desc, id desc'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True, readonly=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    # The currency of the snapshot: a later change of the company currency does not rewrite what was frozen.
    currency_id = fields.Many2one('res.currency', required=True, readonly=True)
    number = fields.Integer(required=True, readonly=True, copy=False)
    taken_by_id = fields.Many2one('res.users', required=True, ondelete='restrict', readonly=True, index=True)
    taken_at = fields.Datetime(required=True, readonly=True)
    note = fields.Text(default='', readonly=True)
    change_id = fields.Many2one('liwan.project.change', ondelete='set null', readonly=True, index=True)
    budget_total = fields.Monetary(currency_field='currency_id', readonly=True)
    planned_start = fields.Date(readonly=True)
    planned_end = fields.Date(readonly=True)
    task_ids = fields.One2many('liwan.project.baseline.task', 'baseline_id', readonly=True)
    task_count = fields.Integer(compute='_compute_task_count')

    _liwan_baseline_number_uniq = models.Constraint(
        'UNIQUE(project_id, number)',
        'A baseline number is unique per project.',
    )
    _liwan_baseline_number_positive = models.Constraint(
        'CHECK(number > 0)',
        'A baseline number is positive.',
    )
    _liwan_baseline_budget_finite = models.Constraint(
        'CHECK(budget_total >= 0 AND budget_total = budget_total)',
        'The baseline budget is a finite amount that is not negative.',
    )
    _liwan_baseline_dates_ordered = models.Constraint(
        'CHECK(planned_start IS NULL OR planned_end IS NULL OR planned_start <= planned_end)',
        'The baseline start is on or before its end.',
    )

    @api.depends('task_ids')
    def _compute_task_count(self):
        counts = {
            baseline.id: count for baseline, count in self.env['liwan.project.baseline.task']._read_group(
                [('baseline_id', 'in', self.ids)], ['baseline_id'], ['__count'],
            )
        }
        for baseline in self:
            baseline.task_count = counts.get(baseline.id, 0)

    # --- visibility ---------------------------------------------------------------
    def _liwan_check_visible(self):
        for record in self:
            _check_project(record.project_id)
        return self

    # --- the plan as it is now ------------------------------------------------------
    @api.model
    def _liwan_current_budget(self, project):
        """The budget of the plan now: the finance budget entries, else the charter estimate, else zero."""
        entries = self.env['liwan.project.finance.entry'].search([('project_id', '=', project.id), ('kind', '=', 'budget')])
        if entries:
            return project.currency_id.round(sum(entries.mapped('amount')))
        if project.liwan_budget_state == 'estimate':
            return project.currency_id.round(project.liwan_budget_amount)
        return 0.0

    @api.model
    def _liwan_plan_tasks(self, project):
        """The tasks that carry the schedule: open and done ones, in schedule order."""
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.tasks.read'):
            raise AccessError(self.env._("Taking a baseline needs access to the tasks of the project."))
        return self.env['project.task'].search([
            ('project_id', '=', project.id), ('active', '=', True), ('state', '!=', TASK_CANCELED_STATE),
        ], order='liwan_planned_start asc, date_deadline asc, id asc')

    # --- creation -----------------------------------------------------------------------
    @api.model
    def _liwan_next_number(self, project):
        """The next number of the project, under a lock on the project row so two managers never share one."""
        try:
            project.lock_for_update()
        except LockError as error:
            raise LiwanBaselineBusy(self.env._("Another baseline is being taken on this project; try again.")) from error
        last = self.search([('project_id', '=', project.id)], order='number desc', limit=1)
        return last.number + 1

    def _liwan_check_taking(self, project, change, has_previous):
        """The rules of taking a baseline: the caller manages the project, the plan is approved, a change covers a controlled project."""
        if not has_previous and project.liwan_charter_state != 'approved':
            raise LiwanCharterState(self.env._("The first baseline needs an approved charter."))
        mode = self.env['liwan.pmo.settings'].change_control_mode()
        if change and mode == 'off':
            raise ValidationError(self.env._("Change control is turned off for this company."))
        if mode == 'required' and project.liwan_phase == 'executing' and not (change and change.state == 'approved'):
            raise LiwanChangeRequired(self.env._("A new baseline of an executing project needs an approved change request."))
        if change and (change.project_id != project or change.state not in CHANGE_COVERING_STATES):
            raise ValidationError(self.env._("Choose an approved change request of this project."))

    @api.model
    def _liwan_clean_note(self, note):
        if note in (None, False):
            return ''
        if not isinstance(note, str) or len(note.strip()) > BASELINE_NOTE_MAX:
            raise ValidationError(self.env._("A baseline note has at most %s characters.", BASELINE_NOTE_MAX))
        return note.strip()

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = _create_values(self, vals_list, BASELINE_CREATE_FIELDS)
        prepared = []
        for vals in vals_list:
            project = _check_project(self.env['project.project'].browse(vals.get('project_id')), manage=True)
            change = self.env['liwan.project.change'].browse(vals.get('change_id') or []).exists()
            if vals.get('change_id') and not change:
                raise ValidationError(self.env._("Choose an approved change request of this project."))
            number = self._liwan_next_number(project)
            self._liwan_check_taking(project, change, number > 1)
            tasks = self._liwan_plan_tasks(project)
            prepared.append((tasks, {
                'project_id': project.id, 'currency_id': project.currency_id.id, 'number': number,
                'taken_by_id': self.env.uid, 'taken_at': fields.Datetime.now(),
                'note': self._liwan_clean_note(vals.get('note')), 'change_id': change.id,
                'budget_total': self._liwan_current_budget(project),
                'planned_start': project.date_start, 'planned_end': project.date,
            }))
        baselines = super().create([values for _tasks, values in prepared])
        marker = self.env.cr.precommit.data
        previous = marker.get(BASELINE_LINE_MARKER)
        marker[BASELINE_LINE_MARKER] = True
        try:
            for baseline, (tasks, _values) in zip(baselines, prepared, strict=True):
                # Equal shares by default: the planned value of phase 5 reads them, nothing is stored twice.
                share = 1.0 / len(tasks) if tasks else 0.0
                self.env['liwan.project.baseline.task'].create([{
                    'baseline_id': baseline.id, 'task_id': task.id, 'task_name': task.name,
                    'planned_start': task.liwan_planned_start,
                    'planned_end': fields.Date.to_date(task.date_deadline),
                    'planned_value_share': share,
                } for task in tasks])
        finally:
            if previous is None:
                marker.pop(BASELINE_LINE_MARKER, None)
            else:
                marker[BASELINE_LINE_MARKER] = previous
        return baselines

    # --- immutability ---------------------------------------------------------------------
    def write(self, vals):
        raise AccessError(self.env._("A baseline is never changed; take a new one."))

    def unlink(self):
        raise AccessError(self.env._("A baseline is never deleted."))


class LiwanProjectBaselineTask(models.Model):
    _name = 'liwan.project.baseline.task'
    _inherit = 'liwan.governance.visibility'
    _description = 'Task line of a project baseline'
    _liwan_scope = 'company'
    _order = 'planned_start asc, planned_end asc, id asc'

    baseline_id = fields.Many2one('liwan.project.baseline', required=True, ondelete='cascade', index=True, readonly=True)
    project_id = fields.Many2one(related='baseline_id.project_id', store=True, index=True)
    company_id = fields.Many2one(related='baseline_id.company_id', store=True, index=True)
    task_id = fields.Many2one('project.task', ondelete='set null', readonly=True, index=True)
    task_name = fields.Char(required=True, readonly=True)
    planned_start = fields.Date(readonly=True)
    planned_end = fields.Date(readonly=True)
    planned_value_share = fields.Float(digits=(16, 8), readonly=True)

    _liwan_baseline_task_share_bounds = models.Constraint(
        'CHECK(planned_value_share >= 0 AND planned_value_share <= 1)',
        'A planned value share is between 0 and 1.',
    )

    def _liwan_check_visible(self):
        for record in self:
            _check_project(record.project_id)
        return self

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.cr.precommit.data.get(BASELINE_LINE_MARKER):
            raise AccessError(self.env._("Baseline lines are written only while a baseline is taken."))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._("A baseline is never changed; take a new one."))

    def unlink(self):
        raise AccessError(self.env._("A baseline is never deleted."))
