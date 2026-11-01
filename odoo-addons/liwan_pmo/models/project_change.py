# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Change requests: the recorded way an approved project changes its scope, schedule or cost.

A request is written by a member of the project, decided by the project sponsor and implemented
by the project manager. The decision fields are written on this model itself, without ``sudo()``:
``write`` refuses them unless a transition method set the precommit marker after its own checks.
"""
import math

from odoo import api, fields, models
from odoo.exceptions import AccessError, LockError, UserError, ValidationError

from .project_constants import CHANGE_NOTE_MAX
from .project_governance import _check_project, _create_values
from .project_project import LiwanStaleWrite

CHANGE_STATES = ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'implemented')
CHANGE_CONTENT_FIELDS = {
    'title', 'description', 'reason', 'category_id', 'impact_schedule_days', 'impact_cost', 'impact_scope',
}
CHANGE_CREATE_FIELDS = CHANGE_CONTENT_FIELDS | {'project_id'}
# Written only by the transition methods below.
CHANGE_TRANSITION_FIELDS = {
    'state', 'decided_by_id', 'decided_at', 'decision_note', 'implemented_at', 'liwan_revision',
}
CHANGE_TRANSITION_MARKER = 'liwan_pmo.change_transition'
MAX_SCHEDULE_DAYS = 36500
CHANGE_CATEGORY_SEEDS = (
    ('scope', 'النطاق'),
    ('schedule', 'الجدول الزمني'),
    ('cost', 'التكلفة'),
    ('quality', 'الجودة'),
    ('other', 'أخرى'),
)


class LiwanChangeState(UserError):
    """The request is not in a state that allows this action or edit."""


class LiwanChangeControlOff(UserError):
    """The company turned change control off."""


class LiwanProjectChangeCategory(models.Model):
    _name = 'liwan.project.change.category'
    _description = 'LiwanOS project change category'
    _liwan_scope = 'company'
    _inherit = ['liwan.project.charter.catalog.mixin']

    seed_key = fields.Char(copy=False, index=True)

    _liwan_change_category_seed_uniq = models.Constraint(
        'UNIQUE(company_id, seed_key)',
        'Change category seed identity must be unique per company.',
    )

    def _liwan_usage_count(self):
        """Requests that use these categories; the route archives instead of deleting, so this only guards ``unlink``."""
        if not self.ids:
            return 0
        return self.env['liwan.project.change'].with_context(active_test=False).search_count([
            ('category_id', 'in', self.ids),
        ])

    def init(self):
        self.env['res.company'].search([])._liwan_seed_change_categories()


class LiwanProjectChange(models.Model):
    _name = 'liwan.project.change'
    _inherit = 'liwan.governance.visibility'
    _description = 'Project change request'
    _liwan_scope = 'company'
    _order = 'number desc, id desc'

    project_id = fields.Many2one('project.project', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='project_id.company_id', store=True, index=True)
    currency_id = fields.Many2one(related='project_id.currency_id')
    number = fields.Integer(required=True, readonly=True, copy=False)
    title = fields.Char(required=True)
    description = fields.Text(default='')
    reason = fields.Text(default='')
    category_id = fields.Many2one('liwan.project.change.category', ondelete='set null', index=True)
    state = fields.Selection(
        [(state, state.title()) for state in CHANGE_STATES],
        default='draft', required=True, copy=False, index=True,
    )
    requester_id = fields.Many2one('res.users', required=True, ondelete='restrict', copy=False, index=True)
    impact_schedule_days = fields.Integer(default=0)
    impact_cost = fields.Monetary(currency_field='currency_id', default=0.0)
    impact_scope = fields.Text(default='')
    decided_by_id = fields.Many2one('res.users', ondelete='restrict', copy=False)
    decided_at = fields.Datetime(copy=False)
    decision_note = fields.Text(default='', copy=False)
    implemented_at = fields.Datetime(copy=False)
    liwan_revision = fields.Integer(default=1, required=True, copy=False)

    _liwan_change_number_uniq = models.Constraint(
        'UNIQUE(project_id, number)',
        'A change request number is unique per project.',
    )
    _liwan_change_state_valid = models.Constraint(
        "CHECK(state IN ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'implemented'))",
        'Unknown change request state.',
    )
    _liwan_change_decision_has_decider = models.Constraint(
        "CHECK(state NOT IN ('approved', 'rejected', 'implemented') OR decided_by_id IS NOT NULL)",
        'A decided change request records who decided it.',
    )

    # --- visibility and creation -------------------------------------------
    def _liwan_check_visible(self):
        for record in self:
            _check_project(record.project_id)
        return self

    @api.model
    def _liwan_require_open(self):
        if self.env['liwan.pmo.settings'].change_control_mode() == 'off':
            raise LiwanChangeControlOff(self.env._("Change control is turned off for this company."))

    @api.model
    def _liwan_next_number(self, project):
        """The next number of the project, under a lock on the project row so two requests never share one."""
        try:
            project.lock_for_update()
        except LockError as error:
            raise LiwanChangeState(self.env._("Another request is being raised on this project; try again.")) from error
        last = self.with_context(active_test=False).search([('project_id', '=', project.id)], order='number desc', limit=1)
        return last.number + 1

    @api.model_create_multi
    def create(self, vals_list):
        self._liwan_require_open()
        vals_list = _create_values(self, vals_list, CHANGE_CREATE_FIELDS)
        for vals in vals_list:
            project = _check_project(self.env['project.project'].browse(vals.get('project_id')))
            if not project._liwan_is_member():
                raise AccessError(self.env._("Only a member of the project can raise a change request."))
            self._liwan_clean_content(vals, partial=False)
            vals.update(
                number=self._liwan_next_number(project), requester_id=self.env.uid,
                state='draft', liwan_revision=1,
            )
        return super().create(vals_list)

    @api.model
    def _liwan_clean_content(self, vals, *, partial):
        if not partial or 'title' in vals:
            title = vals.get('title')
            if not isinstance(title, str) or not title.strip():
                raise ValidationError(self.env._("A change request needs a title."))
            vals['title'] = title.strip()
        if 'impact_schedule_days' in vals:
            days = vals['impact_schedule_days']
            if not isinstance(days, int) or isinstance(days, bool) or abs(days) > MAX_SCHEDULE_DAYS:
                raise ValidationError(self.env._("The schedule impact must be a whole number of days."))
        if 'impact_cost' in vals:
            cost = vals['impact_cost']
            if isinstance(cost, bool) or not isinstance(cost, int | float) or not math.isfinite(cost):
                raise ValidationError(self.env._("The cost impact must be a number."))
        if vals.get('category_id'):
            category = self.env['liwan.project.change.category'].search([
                ('id', '=', vals['category_id']), ('active', '=', True),
            ], limit=1)
            if not category:
                raise ValidationError(self.env._("Choose an active category of this company."))
        return vals

    # --- writes ---------------------------------------------------------------
    def write(self, vals):
        unknown = set(vals) - CHANGE_CONTENT_FIELDS - CHANGE_TRANSITION_FIELDS
        if unknown:
            raise ValidationError(self.env._("Change request field is not writable: %s", sorted(unknown)[0]))
        if set(vals) & CHANGE_TRANSITION_FIELDS:
            if not set(self.ids) <= self.env.cr.precommit.data.get(CHANGE_TRANSITION_MARKER, set()):
                raise AccessError(self.env._("Use the change request actions to decide or implement it."))
            return super().write(vals)
        result = True
        content = self._liwan_clean_content(dict(vals), partial=True)
        for record in self:
            record._liwan_check_editable()
            result = super(LiwanProjectChange, record).write({**content, 'liwan_revision': record.liwan_revision + 1}) and result
        return result

    def _liwan_check_editable(self):
        self._liwan_require_open()
        self._liwan_require_requester()
        self._liwan_require_state('draft')

    def _liwan_apply(self, vals):
        """The *do* step of a transition: its caller already proved the actor and the state."""
        self.ensure_one()
        marker = self.env.cr.precommit.data
        previous = marker.get(CHANGE_TRANSITION_MARKER)
        marker[CHANGE_TRANSITION_MARKER] = {self.id}
        try:
            return self.write({**vals, 'liwan_revision': self.liwan_revision + 1})
        finally:
            if previous is None:
                marker.pop(CHANGE_TRANSITION_MARKER, None)
            else:
                marker[CHANGE_TRANSITION_MARKER] = previous

    # --- concurrency ------------------------------------------------------------
    def _liwan_updated_at(self):
        self.ensure_one()
        return f'v{self.liwan_revision}'

    def _liwan_lock(self, expected=None):
        """Serialize writers on this row, then refuse a stale token."""
        self.ensure_one()
        self.env.flush_all()
        try:
            self.lock_for_update()
        except LockError as error:
            raise LiwanStaleWrite(self.env._("This change request was changed by someone else.")) from error
        self.invalidate_recordset()
        if expected is not None and expected != self._liwan_updated_at():
            raise LiwanStaleWrite(self.env._("This change request was changed by someone else."))
        return self

    # --- rules ------------------------------------------------------------------
    def _liwan_require_state(self, *states):
        if self.state not in states:
            raise LiwanChangeState(self.env._("The change request is not in the expected state."))

    def _liwan_require_requester(self):
        if self.requester_id != self.env.user:
            raise AccessError(self.env._("Only the requester can do this."))

    def _liwan_is_sponsor(self):
        """Only the sponsor named on the project decides; no capability, including the administrator's, replaces it."""
        return self.project_id.liwan_sponsor_id == self.env.user

    def _liwan_require_sponsor(self):
        if not self._liwan_is_sponsor():
            raise AccessError(self.env._("Only the project sponsor can decide a change request."))

    @api.model
    def _liwan_clean_note(self, note, *, required):
        note = note.strip() if isinstance(note, str) else ''
        if (required and not note) or len(note) > CHANGE_NOTE_MAX:
            raise ValidationError(self.env._("A note of 1 to %s characters is required.", CHANGE_NOTE_MAX))
        return note

    def _liwan_check_sponsor_reachable(self):
        sponsor = self.project_id.liwan_sponsor_id
        service = self.env['liwan.access.service']
        if not sponsor or not sponsor.active or not service._liwan_has_capability(sponsor, 'pmo.projects.read'):
            raise ValidationError(self.env._("The project needs a sponsor who can open projects before a change is submitted."))
        try:
            self.project_id.with_user(sponsor).with_company(self.project_id.company_id)._liwan_check_visible_current()
        except AccessError as error:
            raise ValidationError(self.env._("The project needs a sponsor who can open projects before a change is submitted.")) from error

    # --- transitions --------------------------------------------------------------
    def _liwan_submit(self):
        self.ensure_one()
        self._liwan_require_open()
        self._liwan_require_requester()
        self._liwan_require_state('draft')
        user, now = self.env.user, fields.Datetime.now()
        project = self.project_id
        if project.liwan_sponsor_id == user and project._liwan_can_manage():
            # A manager who is also the sponsor decides directly: nobody else could.
            return self._liwan_apply({
                'state': 'approved', 'decided_by_id': user.id, 'decided_at': now, 'decision_note': '',
            })
        self._liwan_check_sponsor_reachable()
        return self._liwan_apply({'state': 'submitted'})

    def _liwan_withdraw(self):
        self.ensure_one()
        self._liwan_require_open()
        self._liwan_require_requester()
        self._liwan_require_state('draft', 'submitted')
        return self._liwan_apply({'state': 'withdrawn'})

    def _liwan_approve(self, note=''):
        self.ensure_one()
        self._liwan_require_open()
        self._liwan_require_sponsor()
        self._liwan_require_state('submitted')
        note = self._liwan_clean_note(note, required=False)
        return self._liwan_apply({
            'state': 'approved', 'decided_by_id': self.env.uid,
            'decided_at': fields.Datetime.now(), 'decision_note': note,
        })

    def _liwan_reject(self, note):
        self.ensure_one()
        self._liwan_require_open()
        self._liwan_require_sponsor()
        self._liwan_require_state('submitted')
        note = self._liwan_clean_note(note, required=True)
        return self._liwan_apply({
            'state': 'rejected', 'decided_by_id': self.env.uid,
            'decided_at': fields.Datetime.now(), 'decision_note': note,
        })

    def _liwan_implement(self):
        self.ensure_one()
        self._liwan_require_open()
        self.project_id._liwan_check_manage()
        self._liwan_require_state('approved')
        return self._liwan_apply({'state': 'implemented', 'implemented_at': fields.Datetime.now()})

    # --- what the caller may do (serialized as flags) ------------------------------------
    def _liwan_allowed_actions(self):
        self.ensure_one()
        if self.env['liwan.pmo.settings'].change_control_mode() == 'off':
            return set()
        actions = set()
        requester = self.requester_id == self.env.user
        if requester and self.state == 'draft':
            actions |= {'edit', 'submit'}
        if requester and self.state in ('draft', 'submitted'):
            actions.add('withdraw')
        if self.state == 'submitted' and self._liwan_is_sponsor():
            actions |= {'approve', 'reject'}
        if self.state == 'approved' and self.project_id._liwan_can_manage():
            actions.add('implement')
        return actions
