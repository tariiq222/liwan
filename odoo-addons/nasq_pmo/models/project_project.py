# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .nasq_settings import CREATORS
from odoo.addons.project.models.project_project import (
    ProjectProject as StockProjectProject,
)
from odoo.addons.project.models.project_task import CLOSED_STATES

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}
# Kept as a distinct exported name: other nasq_pmo modules import
# PROJECT_CREATORS, not nasq_settings.CREATORS, from here.
PROJECT_CREATORS = CREATORS
VISIBILITY_VALUES = ('employees', 'followers')
ACCESS_USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'
POLICY_CREATE_MARKER = 'nasq_pmo.policy_create'
OBJECTIVE_KEYS = ('goal', 'metric', 'target')
DELIVERABLE_KEYS = ('name', 'description', 'acceptance')
BUDGET_STATES = ('unknown', 'estimate')
PRIORITY_VALUES = ('low', 'normal', 'high', 'critical')
CHARTER_STATES = ('draft', 'final')
CHARTER_TEXT_FIELDS = (
    'nasq_authority', 'nasq_rationale', 'nasq_benefits', 'nasq_scope',
    'nasq_exclusions', 'nasq_high_level_requirements', 'nasq_success',
    'nasq_assumptions', 'nasq_constraints', 'nasq_closure',
)
CHARTER_JSON_FIELDS = ('nasq_objectives', 'nasq_deliverables')
CHARTER_MANAGER_FIELDS = {
    'nasq_type_id', 'nasq_owning_unit_id', 'nasq_sponsor_id',
    'nasq_budget_state', 'nasq_budget_amount', 'nasq_priority', 'nasq_charter_state',
    *CHARTER_TEXT_FIELDS, *CHARTER_JSON_FIELDS,
}
PROTECTED_FIELDS = {'nasq_code', 'nasq_revision'}
# Fields a nasq manager (group or per-project assigned user) may write via
# _nasq_write_as_manager/_nasq_write_sudo. Anything else must go through a
# dedicated, explicitly-reviewed path instead of this generic sudo'd write.
MANAGER_WRITABLE = {
    'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date',
    'tag_ids', 'active', 'last_update_status', 'allow_milestones', 'allow_task_dependencies', 'type_ids',
    'nasq_completion_approval', 'nasq_completion_approver_id',
} | CHARTER_MANAGER_FIELDS
PROJECT_CREATE_FIELDS = MANAGER_WRITABLE | {'company_id', 'nasq_code'}
REVISION_CONTENT_FIELDS = MANAGER_WRITABLE | {'company_id'}
COMPLETION_APPROVAL_VALUES = ('none', 'project_manager', 'specific_user')
COMPLETION_BACKFILL_PARAM = 'nasq_pmo.completion_status_backfill_v1_done'


def _not_empty(message, count):
    err = UserError(message)
    err.nasq_count = count
    return err


class NasqStaleWrite(Exception):
    """Write token no longer matches the locked row."""


def _validate_charter_rows(rows, keys, label):
    if rows is None or rows is False:
        return
    if not isinstance(rows, list):
        raise ValidationError(f"{label} must be a list.")
    expected = set(keys)
    for row in rows:
        if not isinstance(row, dict) or set(row) != expected:
            raise ValidationError(f"{label} rows must use exactly {keys}.")
        if any(not isinstance(row[key], str) for key in keys):
            raise ValidationError(f"{label} values must be strings.")
        if not any(row[key].strip() for key in keys):
            raise ValidationError(f"{label} rows must include at least one non-blank value.")


class ProjectProject(models.Model):
    _inherit = 'project.project'

    nasq_completion_approval = fields.Selection(
        [
            ('none', 'None'),
            ('project_manager', 'Project manager'),
            ('specific_user', 'Specific user'),
        ],
        string='Completion approval',
        default='none',
        required=True,
        copy=False,
    )
    nasq_completion_approver_id = fields.Many2one(
        'res.users', string='Completion approver', ondelete='restrict', copy=False, index=True,
    )
    nasq_code = fields.Char(copy=False, index=True)
    # Set only by _nasq_sync_completion_status: the project became 'done'
    # because every task closed, and the status it had before, restored when
    # a task reopens. A manual status change clears both.
    nasq_status_auto_done = fields.Boolean(copy=False)
    nasq_status_before_auto_done = fields.Selection(
        [(value, value) for value in sorted(STATUS_VALUES - {'done'})], copy=False,
    )
    nasq_revision = fields.Integer(default=1, required=True, copy=False)
    nasq_type_id = fields.Many2one(
        'nasq.project.type', ondelete='restrict', check_company=True, index=True,
    )
    nasq_owning_unit_id = fields.Many2one(
        'nasq.project.owning.unit', ondelete='restrict', check_company=True, index=True,
    )
    nasq_sponsor_id = fields.Many2one('res.users', ondelete='set null', index=True)
    nasq_authority = fields.Text(default='')
    nasq_rationale = fields.Text(default='')
    nasq_objectives = fields.Json(default=list)
    nasq_benefits = fields.Text(default='')
    nasq_scope = fields.Text(default='')
    nasq_exclusions = fields.Text(default='')
    nasq_high_level_requirements = fields.Text(default='')
    nasq_deliverables = fields.Json(default=list)
    nasq_success = fields.Text(default='')
    nasq_budget_state = fields.Selection(
        [('unknown', 'Unknown'), ('estimate', 'Estimate')],
        default='unknown',
        required=True,
    )
    nasq_budget_amount = fields.Monetary(currency_field='currency_id', default=0.0)
    nasq_priority = fields.Selection([
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ])
    nasq_assumptions = fields.Text(default='')
    nasq_constraints = fields.Text(default='')
    nasq_closure = fields.Text(default='')
    # A charter starts as a draft the wizard can save at any step; the final
    # step marks it final. Existing projects load as drafts until finalized.
    nasq_charter_state = fields.Selection(
        [('draft', 'Draft'), ('final', 'Final')],
        default='draft',
        required=True,
    )

    _nasq_code_uniq = models.Constraint(
        'UNIQUE(nasq_code)',
        'Project code must be unique.',
    )
    _nasq_budget_unknown_zero = models.Constraint(
        "CHECK(nasq_budget_state != 'unknown' OR nasq_budget_amount = 0)",
        'Unknown budget amount must be zero.',
    )
    _nasq_budget_nonnegative = models.Constraint(
        'CHECK(nasq_budget_amount >= 0 AND nasq_budget_amount = nasq_budget_amount)',
        'Budget amount must be finite and non-negative.',
    )

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'pmo.projects.read',
            )
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'pmo.projects.read',
            )
        return super().check_access(operation)

    def _nasq_check_visible_current(self):
        if not self:
            return self
        if any(
            not project.company_id or project.company_id != self.env.company
            for project in self
        ):
            raise AccessError(self.env._("Project is outside the current company."))
        self.check_access('read')
        return self

    def _nasq_is_bootstrap_create(self):
        """Stock superuser install/import compatibility only.

        Not a caller-controlled exemption. Ordinary internal users and
        ``base.group_system`` business API still receive create requirements.
        ``_nasq_create_from_policy`` enforces the same rules before any
        elevated create.
        """
        return bool(
            self.env.is_superuser()
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER),
        )

    def _nasq_resolved_create_vals(self, vals):
        merged = dict(vals)
        ctx = self.env.context
        if 'user_id' not in merged and 'default_user_id' in ctx:
            merged['user_id'] = ctx['default_user_id']
        if 'date' not in merged and 'default_date' in ctx:
            merged['date'] = ctx['default_date']
        if 'nasq_completion_approval' not in merged:
            if 'default_nasq_completion_approval' in ctx:
                merged['nasq_completion_approval'] = ctx['default_nasq_completion_approval']
            else:
                merged['nasq_completion_approval'] = self.env['nasq.pmo.settings'].get()[
                    'default_completion_approval'
                ]
        if 'nasq_completion_approver_id' not in merged and 'default_nasq_completion_approver_id' in ctx:
            merged['nasq_completion_approver_id'] = ctx['default_nasq_completion_approver_id']
        if 'user_id' not in merged:
            merged['user_id'] = self.env.uid
        if 'company_id' not in merged:
            merged['company_id'] = self.env.company.id
        return merged

    def _nasq_check_create_requirements(self, vals):
        settings = self.env['nasq.pmo.settings'].get()
        manager_id = vals.get('user_id')
        if settings['require_manager_on_create'] and not manager_id:
            raise UserError(self.env._("A project manager is required to create a project."))
        if manager_id:
            self._nasq_check_manager_user(self.env['res.users'].browse(manager_id).exists())
        if settings['require_end_date_on_create'] and not vals.get('date'):
            raise UserError(self.env._("An end date is required to create a project."))
        mode = vals.get('nasq_completion_approval', 'none')
        if mode not in COMPLETION_APPROVAL_VALUES:
            raise UserError(self.env._("Unknown completion approval mode."))
        if mode == 'specific_user' and not vals.get('nasq_completion_approver_id'):
            raise UserError(self.env._("A specific approver is required."))
        if mode != 'specific_user' and vals.get('nasq_completion_approver_id'):
            raise UserError(self.env._("A specific approver is only valid for specific_user mode."))

    def _nasq_check_manager_user(self, user):
        if not user or user.share or not user.active:
            raise UserError(self.env._("The project manager must be an active internal user."))
        if self.env.company not in user.company_ids:
            raise UserError(self.env._("The project manager is outside the current company."))

    @api.model_create_multi
    def create(self, vals_list):
        policy_create = bool(self.env.cr.precommit.data.get(POLICY_CREATE_MARKER))
        public = (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        )
        # A policy create may elevate to sudo for Odoo ACL compatibility, but
        # it is still a business create and must retain company requirements.
        bootstrap = self._nasq_is_bootstrap_create() and not policy_create
        prepared = []
        for vals in vals_list:
            vals = dict(vals)
            vals.setdefault('company_id', self.env.company.id)
            if public:
                if (
                    set(vals) - PROJECT_CREATE_FIELDS
                    or vals.get('company_id', self.env.company.id) != self.env.company.id
                ):
                    raise AccessError(self.env._("Project fields are not allowed."))
                if not self._nasq_can_create():
                    raise AccessError(self.env._("You are not allowed to create projects."))
            if not policy_create and not self.env.is_superuser():
                vals.pop('nasq_code', None)
            if 'nasq_revision' in vals:
                raise AccessError(self.env._("Project revision cannot be set."))
            self._nasq_prepare_charter_vals(vals)
            if not bootstrap:
                vals = self._nasq_resolved_create_vals(vals)
                self._nasq_check_create_requirements(vals)
            prepared.append(vals)
        projects = super().create(prepared)
        if not bootstrap:
            for project in projects:
                if project.nasq_completion_approval == 'specific_user':
                    project._nasq_check_approver_eligible(project.nasq_completion_approver_id)
        return projects

    def _nasq_write_vals(self, vals):
        lone_end = 'date' in vals and 'date_start' not in vals and vals.get('date')
        if not lone_end:
            return super().write(vals)
        missing_start = self.filtered(lambda project: not project.date_start)
        if not missing_start:
            return super().write(vals)
        has_start = self - missing_start
        other = {key: value for key, value in vals.items() if key != 'date'}
        result = True
        if has_start:
            result = super(ProjectProject, has_start).write(vals) and result
        if other:
            result = super(ProjectProject, missing_start).write(other) and result
        # Isolated continuation past stock project.project.write date pairing
        # (addons/project/models/project_project.py:666-679). Nasq authorization
        # already ran. Do not use models.Model.write/_write/raw SQL.
        return super(StockProjectProject, missing_start).write({'date': vals['date']}) and result

    def write(self, vals):
        vals = dict(vals)
        if 'nasq_revision' in vals:
            raise AccessError(self.env._("Project revision cannot be set."))
        if 'nasq_code' in vals and not self.env.is_superuser():
            raise AccessError(self.env._("Project code cannot be set."))
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            self._nasq_check_visible_current()
            if set(vals) - MANAGER_WRITABLE:
                raise AccessError(self.env._("Project fields are not allowed."))
            if any(not project._nasq_can_manage() for project in self):
                raise AccessError(self.env._("Only the project manager can change this project."))
        policy_changed = 'nasq_completion_approval' in vals or 'nasq_completion_approver_id' in vals
        manager_changed = 'user_id' in vals
        archived = vals.get('active') is False
        old_modes = {project.id: project.nasq_completion_approval for project in self}
        if policy_changed or manager_changed or archived:
            pending = self.env['project.task'].sudo().search([
                ('project_id', 'in', self.ids),
                ('nasq_completion_pending', '=', True),
            ])
            self.env['project.task']._nasq_lock_projects_then_tasks(self, pending)
            self.invalidate_recordset()
            pending.invalidate_recordset()
        if policy_changed:
            self._nasq_check_completion_policy_vals(vals)
        self._nasq_prepare_charter_vals(vals, records=self)
        content = set(vals) & REVISION_CONTENT_FIELDS
        result = self._nasq_write_vals(vals)
        if content and self.ids:
            self._nasq_bump_revision()
        if policy_changed or archived:
            self._nasq_invalidate_completion_requests()
        elif manager_changed:
            stale = self.filtered(
                lambda project: old_modes.get(project.id) == 'project_manager'
                or project.nasq_completion_approval == 'project_manager',
            )
            if stale:
                stale._nasq_invalidate_completion_requests()
        return result

    def unlink(self):
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            raise AccessError(self.env._("Projects cannot be permanently deleted."))
        return super().unlink()

    # --- rules ---------------------------------------------------------------
    def _nasq_is_admin(self):
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.projects.manage',
        )

    def _nasq_is_manager(self):
        """Group-level rule: project managers and customer admins (any project)."""
        return self._nasq_is_admin()

    def _nasq_can_manage(self):
        """Per-project rule: the group rule OR being this project's assigned manager."""
        self.ensure_one()
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.projects.manage', record=self,
        )

    def _nasq_check_manage(self):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only the project manager can change this project."))

    def _nasq_can_create(self):
        service = self.env['nasq.access.service']
        return (
            service._nasq_has_capability(
                self.env.user, 'pmo.projects.create',
            )
            or (
                service._nasq_is_employee_principal(self.env.user)
                and self.env['nasq.pmo.settings'].get()['project_creators'] == 'employees'
            )
        )

    def _nasq_write_sudo(self, vals):
        """Write project fields in sudo, whitelisted, with NO manage-rule check.

        This is the *do* step only: it trusts the caller already proved the
        write is authorized. It exists separately from _nasq_write_as_manager
        so a *do* step (e.g. _nasq_do_set_status) never re-runs
        _nasq_can_manage after its own check step has already run — an
        overlay that widens a check step (e.g. _nasq_check_status_allowed)
        must not be blocked again here by the unwidened base rule. Odoo's
        project ACL has no notion of "the manager of this project" (only the
        project-manager *group* may write project.project), which is why the
        write itself runs in sudo once the caller has done its own check.
        Third documented sudo() in nasq_pmo (settings, policy create, this).
        """
        self.ensure_one()
        bad = set(vals) - MANAGER_WRITABLE
        if bad:
            msg = f"cannot write non-whitelisted project fields: {sorted(bad)}"
            raise ValueError(msg)
        self.sudo().write(vals)
        return self

    def _nasq_write_as_manager(self, vals):
        """Check the manage rule, then write project fields on the caller's behalf.

        The check-and-write pair for every project-level write nasq performs
        on a manager's behalf outside of a dedicated *do* step. See
        _nasq_write_sudo for the write itself and why a *do* step bypasses
        this check.
        """
        self._nasq_check_manage()
        return self._nasq_write_sudo(vals)

    # --- create --------------------------------------------------------------
    def _nasq_create_from_policy(self, name, extra=None, user_id=None, date_end=None):
        """Create a project the nasq way: policy check, defaults, default stages.

        When the company policy lets every employee create projects, the create
        itself runs in sudo (Odoo's ACL reserves project creation to managers);
        the policy is the explicit, admin-set widening of that ACL, and
        ``create_uid``/``user_id`` still record the employee. Second documented
        ``sudo()`` in nasq_pmo.

        Required-on-create company settings are enforced here for every
        policy create, including ordinary ORM callers of this helper, even
        when the subsequent ``create`` is elevated. Stock superuser
        ``project.create`` used by install/import fixtures is the documented
        compatibility boundary and is not a caller-controlled exemption.
        """
        if not self._nasq_can_create():
            raise AccessError(self.env._("You are not allowed to create projects."))
        vals = self._nasq_create_vals(name, user_id=user_id, date_end=date_end)
        if extra:
            vals.update(extra)
        env = self.env if self._nasq_is_manager() else self.sudo().env
        marker = self.env.cr.precommit.data
        previous = marker.get(POLICY_CREATE_MARKER)
        marker[POLICY_CREATE_MARKER] = True
        try:
            project = env['project.project'].create(vals)
        finally:
            if previous is None:
                marker.pop(POLICY_CREATE_MARKER, None)
            else:
                marker[POLICY_CREATE_MARKER] = previous
        return self.browse(project.id)

    def _nasq_create_vals(self, name, user_id=None, date_end=None):
        stages = self.env['nasq.pmo.settings']._default_stage_vals()
        settings = self.env['nasq.pmo.settings'].get()
        manager_id = self.env.uid if user_id is None else user_id
        vals = {
            'name': name,
            'user_id': manager_id or False,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
            'allow_milestones': True,
            'nasq_completion_approval': settings['default_completion_approval'],
            'type_ids': [(0, 0, s) for s in stages],
            'nasq_code': self._nasq_next_code(),
        }
        if date_end:
            # Upstream project.create preserves a lone end date. Do not invent
            # a start date; only persist the supplied end.
            vals['date'] = date_end
        return vals

    def _nasq_check_completion_policy_vals(self, vals):
        mode = vals.get('nasq_completion_approval')
        if mode is not None and mode not in COMPLETION_APPROVAL_VALUES:
            raise UserError(self.env._("Unknown completion approval mode."))
        for project in self:
            next_mode = vals.get('nasq_completion_approval', project.nasq_completion_approval)
            approver_id = vals.get('nasq_completion_approver_id', project.nasq_completion_approver_id.id)
            if next_mode == 'specific_user':
                user = self.env['res.users'].browse(approver_id).exists() if approver_id else self.env['res.users']
                if not user:
                    raise UserError(self.env._("A specific approver is required."))
                project._nasq_check_approver_eligible(user)
            elif vals.get('nasq_completion_approver_id'):
                raise UserError(self.env._("A specific approver is only valid for specific_user mode."))

    def _nasq_check_approver_eligible(self, user):
        self.ensure_one()
        if not user or user.share or not user.active:
            raise UserError(self.env._("The selected approver must be an active internal user."))
        if self.env.company not in user.company_ids:
            raise UserError(self.env._("The selected approver is outside the current company."))
        if not self.env['nasq.access.service']._nasq_has_capability(
            user, 'pmo.tasks.approve', record=self,
        ):
            raise UserError(self.env._("The selected approver must already have approval capability."))
        try:
            self.with_user(user).with_company(self.env.company)._nasq_check_visible_current()
        except AccessError as error:
            raise UserError(self.env._("The selected approver cannot see this project.")) from error

    def _nasq_invalidate_completion_requests(self):
        tasks = self.env['project.task'].sudo().search([
            ('project_id', 'in', self.ids),
            ('nasq_completion_pending', '=', True),
        ])
        if tasks:
            tasks._nasq_clear_completion_request(invalidate=True)

    def _nasq_completion_reviewer(self):
        self.ensure_one()
        if self.nasq_completion_approval == 'project_manager':
            return self.user_id
        if self.nasq_completion_approval == 'specific_user':
            return self.nasq_completion_approver_id
        return self.env['res.users']

    @api.model
    def _nasq_next_code(self):
        # Fourth documented nasq_pmo elevated case: ir.sequence nextval is
        # provisioning of a new code (with settings, policy create, manager
        # write). Not a visibility bypass and not a CLAUDE.md change.
        return self.env['ir.sequence'].sudo().next_by_code('nasq.project.code') or False

    def _nasq_updated_at(self):
        self.ensure_one()
        return 'v%s' % (self.nasq_revision or 0)

    def _nasq_lock_for_write(self, expected):
        self.ensure_one()
        self.env.cr.execute(
            '''
                SELECT nasq_revision, company_id
                  FROM project_project
                 WHERE id = %s
                   FOR UPDATE
            ''',
            [self.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise AccessError(self.env._("Project is outside the current company."))
        self.invalidate_recordset()
        self._nasq_check_visible_current()
        self._nasq_check_manage()
        current = 'v%s' % (row[0] or 0)
        if expected != current:
            raise NasqStaleWrite(self.env._("This project was changed by someone else."))

    def _nasq_bump_revision(self):
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE project_project SET nasq_revision = COALESCE(nasq_revision, 0) + 1 WHERE id IN %s',
            [tuple(self.ids)],
        )
        self.invalidate_recordset(['nasq_revision'])

    @api.model
    def _nasq_eligible_user(self, user, current_id=None):
        if not user:
            return False
        if user.share:
            return False
        # Validation must reject foreign-company ids generically. Reading the
        # related companies as the caller can trip res.company record rules and
        # turn the intended 422 into a 403 that leaks an authorization boundary.
        if self.env.company.id not in user.sudo().company_ids.ids:
            return False
        return user.active or user.id == current_id

    def _nasq_prepare_charter_vals(self, vals, records=None):
        self._nasq_prepare_json_vals(vals)
        self._nasq_prepare_budget_vals(vals)
        self._nasq_prepare_assignment_vals(vals, records)

    def _nasq_prepare_json_vals(self, vals):
        for field, keys, label in (
            ('nasq_objectives', OBJECTIVE_KEYS, 'objectives'),
            ('nasq_deliverables', DELIVERABLE_KEYS, 'deliverables'),
        ):
            if field not in vals:
                continue
            value = vals[field]
            if value is None or value is False:
                vals[field] = []
                continue
            if isinstance(value, bool | int | float) or not isinstance(value, list):
                raise ValidationError(f"{label} must be a list.")
            _validate_charter_rows(value, keys, label)

    def _nasq_prepare_budget_vals(self, vals):
        if 'nasq_budget_amount' in vals:
            amount = vals['nasq_budget_amount']
            if isinstance(amount, bool | str):
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if amount is not None and amount is not False:
                if not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                    raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
        if vals.get('nasq_budget_state') != 'unknown':
            return
        if 'nasq_budget_amount' in vals:
            amount = vals['nasq_budget_amount']
            if amount not in (0, 0.0, None, False):
                raise ValidationError(self.env._("Unknown budget amount must be zero."))
        vals['nasq_budget_amount'] = 0.0

    def _nasq_prepare_assignment_vals(self, vals, records=None):
        records = records if records is not None else self.browse()
        if 'nasq_sponsor_id' in vals:
            sponsor = vals['nasq_sponsor_id']
            if sponsor:
                user = self.env['res.users'].with_context(active_test=False).browse(int(sponsor)).exists()
                current_ids = {project.nasq_sponsor_id.id for project in records if project.nasq_sponsor_id}
                current_id = next(iter(current_ids)) if len(current_ids) == 1 else None
                if not self._nasq_eligible_user(user, current_id=current_id):
                    raise ValidationError(self.env._("Sponsor must be an active internal user in the current company."))
        for field, model in (
            ('nasq_type_id', 'nasq.project.type'),
            ('nasq_owning_unit_id', 'nasq.project.owning.unit'),
        ):
            if field not in vals or not vals[field]:
                continue
            record = self.env[model].with_context(active_test=False).browse(int(vals[field])).exists()
            if not record:
                raise ValidationError(self.env._("Catalog references must belong to the project company."))
            current_ids = {project[field].id for project in records if project[field]}
            current_id = next(iter(current_ids)) if len(current_ids) == 1 else None
            if not record.active and record.id != current_id:
                raise ValidationError(self.env._("Catalog references must be active."))
            for project in records:
                if not project.company_id:
                    raise ValidationError(self.env._("A company-less project cannot take a catalog reference."))
                if record.company_id != project.company_id:
                    raise ValidationError(self.env._("Catalog references must belong to the project company."))
            if not records and record.company_id != self.env.company:
                raise ValidationError(self.env._("Catalog references must belong to the project company."))

    @api.constrains('nasq_objectives')
    def _check_nasq_objectives(self):
        for project in self:
            _validate_charter_rows(project.nasq_objectives, OBJECTIVE_KEYS, 'objectives')

    @api.constrains('nasq_deliverables')
    def _check_nasq_deliverables(self):
        for project in self:
            _validate_charter_rows(project.nasq_deliverables, DELIVERABLE_KEYS, 'deliverables')

    @api.constrains('nasq_type_id', 'nasq_owning_unit_id', 'company_id')
    def _check_nasq_catalog_company(self):
        for project in self:
            for record in (project.nasq_type_id, project.nasq_owning_unit_id):
                if not record:
                    continue
                if not project.company_id:
                    raise ValidationError(self.env._("A company-less project cannot take a catalog reference."))
                if record.company_id != project.company_id:
                    raise ValidationError(self.env._("Catalog references must belong to the project company."))

    @api.constrains('date_start', 'date')
    def _check_nasq_milestone_bounds(self):
        milestones = self.env['project.milestone'].sudo().search([
            ('project_id', 'in', self.ids),
        ])
        milestones._nasq_validate_schedule_bounds()

    @api.constrains('nasq_priority')
    def _check_nasq_priority(self):
        for project in self:
            if project.nasq_priority and project.nasq_priority not in PRIORITY_VALUES:
                raise ValidationError(self.env._("Invalid project priority."))

    @api.constrains('nasq_budget_state', 'nasq_budget_amount')
    def _check_nasq_budget(self):
        for project in self:
            if project.nasq_budget_state not in BUDGET_STATES:
                raise ValidationError(self.env._("Budget state must be unknown or estimate."))
            amount = project.nasq_budget_amount
            if isinstance(amount, bool) or not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if project.nasq_budget_state == 'unknown' and amount:
                raise ValidationError(self.env._("Unknown budget amount must be zero."))

    # --- archive -------------------------------------------------------------
    def _nasq_archive(self):
        return self._nasq_write_as_manager({'active': False})

    def _nasq_unarchive(self):
        return self._nasq_write_as_manager({'active': True})

    # --- status (phase 2) ----------------------------------------------------
    def _nasq_set_status(self, status):
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._nasq_check_status_allowed(status)
        self._nasq_do_set_status(status)
        self._nasq_post_status_hook(status)
        return self

    def _nasq_check_status_allowed(self, status):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only a project manager can set the project status."))

    def _nasq_do_set_status(self, status):
        """The *do* step: no manage-rule check (see _nasq_check_status_allowed)."""
        self._nasq_write_sudo({'last_update_status': status})
        if self.nasq_status_auto_done:
            self.sudo().write({'nasq_status_auto_done': False, 'nasq_status_before_auto_done': False})

    def _nasq_sync_completion_status(self):
        """Mark a project done once every task is closed, and undo that on reopen.

        Complete means at least one done task and no open one (cancelled tasks
        do not block). A project with no tasks never completes. Only an
        automatic completion is reverted; a manager's own 'done' stays.

        sudo(): documented automatic-completion case. It runs after a task
        mutation the caller was already authorized for, reads integer counts
        over all of the project's tasks (the caller may not see every task)
        and writes only the status, its two bookkeeping fields and the status
        update that records the change.
        """
        Task = self.env['project.task'].sudo()
        for project in self.sudo().filtered(lambda p: p.active):
            domain = [('project_id', '=', project.id)]
            open_count = Task.search_count(domain + [('state', 'not in', list(CLOSED_STATES))])
            done_count = Task.search_count(domain + [('state', '=', '1_done')])
            complete = not open_count and done_count > 0
            if complete and project.last_update_status != 'done':
                previous = project.last_update_status
                project.write({
                    'nasq_status_auto_done': True,
                    'nasq_status_before_auto_done': previous if previous in STATUS_VALUES else False,
                })
                project._nasq_record_status('done', self.env._("All tasks are complete"))
            elif not complete and project.nasq_status_auto_done:
                restore = project.nasq_status_before_auto_done or 'on_track'
                project.write({'nasq_status_auto_done': False, 'nasq_status_before_auto_done': False})
                if project.last_update_status == 'done':
                    project._nasq_record_status(restore, self.env._("The project has open tasks again"))

    @api.model
    def _nasq_backfill_completion_status(self):
        """One-time upgrade step: apply automatic completion to existing projects.

        Runs from trusted module data as the superuser. The marker keeps a
        later module update from re-completing a project whose manager has
        since chosen another status by hand. Each project's update title uses
        its company's language, since there is no acting user.
        """
        if not self.env.is_superuser():
            msg = 'completion status backfill requires superuser'
            raise AccessError(msg)
        params = self.env['ir.config_parameter'].sudo()
        if params.get_param(COMPLETION_BACKFILL_PARAM) == '1':
            return True
        for project in self.search([]):
            lang = project.company_id.partner_id.lang or self.env.lang
            project.with_context(lang=lang)._nasq_sync_completion_status()
        params.set_param(COMPLETION_BACKFILL_PARAM, '1')
        return True

    def _nasq_record_status(self, status, name):
        # Odoo derives last_update_status from the latest project.update, so a
        # status change is recorded as one, named for why it happened.
        self.ensure_one()
        self.env['project.update'].sudo().create({'project_id': self.id, 'status': status, 'name': name})

    def _nasq_post_status_hook(self, status):
        """Extension point; nothing in core."""

    # --- updates -------------------------------------------------------------
    def _nasq_post_update(self, name, description=''):
        """Create a text project.update that carries the current status unchanged.

        The status is set in project settings (_nasq_set_status) or by
        _nasq_sync_completion_status, never by posting an update.
        """
        self.ensure_one()
        self._nasq_check_manage()
        current = self.last_update_status
        return self.env['project.update'].create({
            'project_id': self.id,
            'status': current if current in STATUS_VALUES else 'on_track',
            'name': name,
            'description': description or False,
        })

    # --- stages --------------------------------------------------------------
    def _nasq_stage_task_count(self, stage):
        # sudo(): only an integer count is returned (never task records), so this
        # cannot leak data; without it, ir.rule on a followers-only project would
        # under-count hidden tasks and let a stage with tasks the caller can't see
        # be deleted out from under them.
        return self.env['project.task'].sudo().with_context(active_test=False).search_count(
            [('project_id', '=', self.id), ('stage_id', '=', stage.id)])

    def _nasq_add_stage(self, name, fold=False):
        self._nasq_check_manage()
        last = max(self.type_ids.mapped('sequence'), default=0)
        return self.env['project.task.type'].create({
            'name': name, 'fold': fold, 'sequence': last + 10, 'project_ids': [(4, self.id)],
        })

    def _nasq_update_stage(self, stage, vals):
        self._nasq_check_manage()
        if stage not in self.type_ids:
            msg = "stage does not belong to this project"
            raise ValueError(msg)
        stage.write({k: v for k, v in vals.items() if k in ('name', 'fold')})
        return stage

    def _nasq_reorder_stages(self, ids):
        self._nasq_check_manage()
        if sorted(ids) != sorted(self.type_ids.ids):
            msg = "ids must be a permutation of the project's stage ids"
            raise ValueError(msg)
        for i, stage_id in enumerate(ids):
            self.env['project.task.type'].browse(stage_id).write({'sequence': (i + 1) * 10})
        return self.type_ids.sorted(lambda s: (s.sequence, s.id))

    def _nasq_delete_stage(self, stage):
        self._nasq_check_manage()
        if stage not in self.type_ids:
            msg = "stage does not belong to this project"
            raise ValueError(msg)
        count = self._nasq_stage_task_count(stage)
        if count:
            raise _not_empty(self.env._("This stage still holds tasks."), count)
        if len(stage.project_ids) > 1:
            # Shared stage: detach from this project only.
            self._nasq_write_as_manager({'type_ids': [(3, stage.id)]})
        else:
            stage.unlink()

    # --- followers -----------------------------------------------------------
    def _nasq_followers(self):
        partners = self.message_partner_ids
        return partners.mapped('user_ids').filtered(lambda u: not u.share and u.active)

    def _nasq_add_follower(self, user):
        self._nasq_check_manage()
        # sudo(): mail.thread.message_subscribe checks 'write' on the project
        # itself, which Odoo's ACL grants only to the project-manager group —
        # same rationale as _nasq_write_as_manager, for the assigned-user-as-
        # manager case Odoo's own ACL doesn't know about.
        self.sudo().message_subscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    def _nasq_remove_follower(self, user):
        self._nasq_check_manage()
        # sudo(): same rationale as _nasq_add_follower above.
        self.sudo().message_unsubscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    # --- milestones ----------------------------------------------------------
    def _nasq_milestone_task_counts(self, milestone):
        # sudo(): only integer counts are returned (never task records); see
        # _nasq_stage_task_count for why an unsudo'd count would under-count on
        # followers-only projects and let a non-empty milestone be deleted.
        Task = self.env['project.task'].sudo()
        domain = [('project_id', '=', self.id), ('milestone_id', '=', milestone.id)]
        return Task.search_count(domain), Task.search_count(domain + [('state', 'in', ('1_done', '1_canceled'))])

    def _nasq_create_milestone(self, name, deadline=None, start_date=None, deliverables=None):
        self._nasq_check_manage()
        if not self.allow_milestones:
            self._nasq_write_as_manager({'allow_milestones': True})
        return self.env['project.milestone'].create({
            'project_id': self.id, 'name': name,
            'deadline': fields.Date.to_date(deadline) if deadline else False,
            'nasq_start_date': fields.Date.to_date(start_date) if start_date else False,
            'nasq_deliverables': deliverables or [],
        })

    def _nasq_update_milestone(self, milestone, vals):
        self._nasq_check_manage()
        if milestone.project_id != self:
            msg = "milestone does not belong to this project"
            raise ValueError(msg)
        clean = {}
        if 'name' in vals:
            clean['name'] = vals['name']
        if 'deadline' in vals:
            clean['deadline'] = fields.Date.to_date(vals['deadline']) if vals['deadline'] else False
        if 'start_date' in vals:
            clean['nasq_start_date'] = fields.Date.to_date(vals['start_date']) if vals['start_date'] else False
        if 'deliverables' in vals:
            clean['nasq_deliverables'] = vals['deliverables']
        if 'is_reached' in vals:
            clean['is_reached'] = bool(vals['is_reached'])
        milestone.write(clean)
        return milestone

    def _nasq_delete_milestone(self, milestone):
        self._nasq_check_manage()
        if milestone.project_id != self:
            msg = "milestone does not belong to this project"
            raise ValueError(msg)
        total, _done = self._nasq_milestone_task_counts(milestone)
        if total:
            raise _not_empty(self.env._("Tasks are still linked to this milestone."), total)
        milestone.unlink()
