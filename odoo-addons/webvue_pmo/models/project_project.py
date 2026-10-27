# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .project_charter import WebVueCharterState
from .project_constants import (
    ACCESS_USER_CREATE_MARKER,
    BUDGET_STATES,
    CHARTER_APPROVAL_FIELDS,
    CHARTER_RESET_VALS,
    COMPLETION_APPROVAL_VALUES,
    DELIVERABLE_KEYS,
    MANAGER_WRITABLE,
    OBJECTIVE_KEYS,
    POLICY_CREATE_MARKER,
    PRIORITY_VALUES,
    PROJECT_CREATE_FIELDS,
    REVISION_CONTENT_FIELDS,
    STATUS_VALUES,
    VISIBILITY_VALUES,
    _validate_charter_rows,
)
from .webvue_settings import CREATORS
from odoo.addons.project.models.project_project import (
    ProjectProject as StockProjectProject,
)

__all__ = [
    'BUDGET_STATES',
    'DELIVERABLE_KEYS',
    'MAX_COPY_MILESTONES',
    'MAX_COPY_TASKS',
    'OBJECTIVE_KEYS',
    'PRIORITY_VALUES',
    'PROJECT_CREATORS',
    'STATUS_VALUES',
    'VISIBILITY_VALUES',
    'WebVueCharterState',
    'WebVueStaleWrite',
]

# Kept as a distinct exported name: other webvue_pmo modules import
# PROJECT_CREATORS, not webvue_settings.CREATORS, from here.
PROJECT_CREATORS = CREATORS

# Copy limits of _webvue_copy_structure, kept here as module-level knobs.
MAX_COPY_TASKS = 500
MAX_COPY_MILESTONES = 100


class WebVueStaleWrite(Exception):
    """Write token no longer matches the locked row."""


class ProjectProject(models.Model):
    _inherit = 'project.project'

    webvue_completion_approval = fields.Selection(
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
    webvue_completion_approver_id = fields.Many2one(
        'res.users', string='Completion approver', ondelete='restrict', copy=False, index=True,
    )
    webvue_code = fields.Char(copy=False, index=True)

    webvue_revision = fields.Integer(default=1, required=True, copy=False)
    webvue_type_id = fields.Many2one(
        'webvue.project.type', ondelete='restrict', check_company=True, index=True,
    )
    webvue_owning_unit_id = fields.Many2one(
        'webvue.project.owning.unit', ondelete='restrict', check_company=True, index=True,
    )
    webvue_sponsor_id = fields.Many2one('res.users', ondelete='set null', index=True)
    webvue_authority = fields.Text(default='')
    webvue_rationale = fields.Text(default='')
    webvue_objectives = fields.Json(default=list)
    webvue_benefits = fields.Text(default='')
    webvue_scope = fields.Text(default='')
    webvue_exclusions = fields.Text(default='')
    webvue_high_level_requirements = fields.Text(default='')
    webvue_deliverables = fields.Json(default=list)
    webvue_success = fields.Text(default='')
    webvue_budget_state = fields.Selection(
        [('unknown', 'Unknown'), ('estimate', 'Estimate')],
        default='unknown',
        required=True,
    )
    webvue_budget_amount = fields.Monetary(currency_field='currency_id', default=0.0)
    webvue_priority = fields.Selection([
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ])
    webvue_assumptions = fields.Text(default='')
    webvue_constraints = fields.Text(default='')
    webvue_closure = fields.Text(default='')
    # draft → submitted (waiting for the sponsor) → approved. Only the
    # _webvue_charter_* transitions write these; see CHARTER_APPROVAL_FIELDS.
    webvue_charter_state = fields.Selection(
        [('draft', 'Draft'), ('submitted', 'Submitted'), ('approved', 'Approved')],
        default='draft',
        required=True,
        copy=False,
    )
    webvue_charter_submitted_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    webvue_charter_submitted_at = fields.Datetime(copy=False)
    webvue_charter_approved_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    webvue_charter_approved_at = fields.Datetime(copy=False)
    webvue_charter_return_note = fields.Text(default='', copy=False)

    _webvue_code_uniq = models.Constraint(
        'UNIQUE(webvue_code)',
        'Project code must be unique.',
    )
    _webvue_budget_unknown_zero = models.Constraint(
        "CHECK(webvue_budget_state != 'unknown' OR webvue_budget_amount = 0)",
        'Unknown budget amount must be zero.',
    )
    _webvue_budget_nonnegative = models.Constraint(
        'CHECK(webvue_budget_amount >= 0 AND webvue_budget_amount = webvue_budget_amount)',
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
            self.env['webvue.access.service']._webvue_require_capability(
                'pmo.projects.read',
            )
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def _check_access(self, operation):
        # Stock attachment downloads use _filtered_access on their comodel,
        # which bypasses a check_access-only override. Keep the non-raising
        # hook shared by check_access, has_access and _filtered_access.
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            if not self.env['webvue.access.service']._webvue_has_capability(
                self.env.user, 'pmo.projects.read',
            ):
                return self, lambda: AccessError('forbidden')
        return super()._check_access(operation)

    def _webvue_check_visible_current(self):
        if not self:
            return self
        if any(
            not project.company_id or project.company_id != self.env.company
            for project in self
        ):
            raise AccessError(self.env._("Project is outside the current company."))
        self.check_access('read')
        return self

    def _webvue_is_bootstrap_create(self):
        """Stock superuser install/import compatibility only.

        Not a caller-controlled exemption. Ordinary internal users and
        ``base.group_system`` business API still receive create requirements.
        ``_webvue_create_from_policy`` enforces the same rules before any
        elevated create.
        """
        return bool(
            self.env.is_superuser()
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER),
        )

    def _webvue_resolved_create_vals(self, vals):
        merged = dict(vals)
        ctx = self.env.context
        if 'user_id' not in merged and 'default_user_id' in ctx:
            merged['user_id'] = ctx['default_user_id']
        if 'date' not in merged and 'default_date' in ctx:
            merged['date'] = ctx['default_date']
        if 'webvue_completion_approval' not in merged:
            if 'default_webvue_completion_approval' in ctx:
                merged['webvue_completion_approval'] = ctx['default_webvue_completion_approval']
            else:
                merged['webvue_completion_approval'] = self.env['webvue.pmo.settings']._core_values()[
                    'default_completion_approval'
                ]
        if 'webvue_completion_approver_id' not in merged and 'default_webvue_completion_approver_id' in ctx:
            merged['webvue_completion_approver_id'] = ctx['default_webvue_completion_approver_id']
        if 'user_id' not in merged:
            merged['user_id'] = self.env.uid
        if 'company_id' not in merged:
            merged['company_id'] = self.env.company.id
        return merged

    def _webvue_check_create_requirements(self, vals):
        settings = self.env['webvue.pmo.settings']._core_values()
        manager_id = vals.get('user_id')
        if settings['require_manager_on_create'] and not manager_id:
            raise UserError(self.env._("A project manager is required to create a project."))
        if manager_id:
            self._webvue_check_manager_user(self.env['res.users'].browse(manager_id).exists())
        if settings['require_end_date_on_create'] and not vals.get('date'):
            raise UserError(self.env._("An end date is required to create a project."))
        mode = vals.get('webvue_completion_approval', 'none')
        if mode not in COMPLETION_APPROVAL_VALUES:
            raise UserError(self.env._("Unknown completion approval mode."))
        if mode == 'specific_user' and not vals.get('webvue_completion_approver_id'):
            raise UserError(self.env._("A specific approver is required."))
        if mode != 'specific_user' and vals.get('webvue_completion_approver_id'):
            raise UserError(self.env._("A specific approver is only valid for specific_user mode."))

    def _webvue_check_manager_user(self, user):
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
        bootstrap = self._webvue_is_bootstrap_create() and not policy_create
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
                if not self._webvue_can_create():
                    raise AccessError(self.env._("You are not allowed to create projects."))
            if not policy_create and not self.env.is_superuser():
                vals.pop('webvue_code', None)
            if 'webvue_revision' in vals:
                raise AccessError(self.env._("Project revision cannot be set."))
            self._webvue_prepare_charter_vals(vals)
            if not bootstrap:
                vals = self._webvue_resolved_create_vals(vals)
                self._webvue_check_create_requirements(vals)
            prepared.append(vals)
        if prepared:
            self.env['webvue.entitlement.service']._webvue_claim_projects(len(prepared))
        projects = super().create(prepared)
        if not bootstrap:
            for project in projects:
                if project.webvue_completion_approval == 'specific_user':
                    project._webvue_check_approver_eligible(project.webvue_completion_approver_id)
        return projects

    def _webvue_write_vals(self, vals):
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
        # (addons/project/models/project_project.py:666-679). WebVue authorization
        # already ran. Do not use models.Model.write/_write/raw SQL.
        return super(StockProjectProject, missing_start).write({'date': vals['date']}) and result

    def write(self, vals):
        vals = dict(vals)
        if 'webvue_revision' in vals:
            raise AccessError(self.env._("Project revision cannot be set."))
        if 'webvue_code' in vals and not self.env.is_superuser():
            raise AccessError(self.env._("Project code cannot be set."))
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            self._webvue_check_visible_current()
            if set(vals) - MANAGER_WRITABLE:
                raise AccessError(self.env._("Project fields are not allowed."))
            if any(not project._webvue_can_manage() for project in self):
                raise AccessError(self.env._("Only the project manager can change this project."))
        policy_changed = 'webvue_completion_approval' in vals or 'webvue_completion_approver_id' in vals
        manager_changed = 'user_id' in vals
        archived = vals.get('active') is False
        restored = vals.get('active') is True
        old_modes = {project.id: project.webvue_completion_approval for project in self}
        if policy_changed or manager_changed or archived:
            pending = self.env['project.task'].sudo().search([
                ('project_id', 'in', self.ids),
                ('webvue_completion_pending', '=', True),
            ])
            self.env['project.task']._webvue_lock_projects_then_tasks(self, pending)
            self.invalidate_recordset()
            pending.invalidate_recordset()
        if policy_changed:
            self._webvue_check_completion_policy_vals(vals)
        self._webvue_prepare_charter_vals(vals, records=self)
        reopen = self._webvue_charter_guard(vals)
        if restored:
            inactive = self.filtered(lambda project: not project.active)
            if inactive:
                self.env['webvue.entitlement.service']._webvue_claim_projects(len(inactive))
        elif archived:
            active = self.filtered(lambda project: project.active)
            if active:
                self.env['webvue.entitlement.service']._webvue_claim_projects(-len(active))
        content = set(vals) & REVISION_CONTENT_FIELDS
        result = self._webvue_write_vals(vals)
        if content and self.ids:
            self._webvue_bump_revision()
        if policy_changed or archived:
            self._webvue_invalidate_completion_requests()
        elif manager_changed:
            stale = self.filtered(
                lambda project: old_modes.get(project.id) == 'project_manager'
                or project.webvue_completion_approval == 'project_manager',
            )
            if stale:
                stale._webvue_invalidate_completion_requests()
        for project in reopen:
            project._webvue_write_charter_approval(dict(CHARTER_RESET_VALS))
        if vals.get('privacy_visibility') == 'followers':
            # A waiting sponsor must keep read access when the project turns private.
            for project in self.filtered(lambda p: p.webvue_charter_state == 'submitted'):
                sponsor = project.webvue_sponsor_id
                if sponsor and project._webvue_can_manage() and sponsor not in project._webvue_followers():
                    project._webvue_add_follower(sponsor)
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
    def _webvue_is_admin(self):
        return self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'pmo.projects.manage',
        )

    def _webvue_is_manager(self):
        """Group-level rule: project managers and customer admins (any project)."""
        return self._webvue_is_admin()

    def _webvue_can_manage(self):
        """Per-project rule: the group rule OR being this project's assigned manager."""
        self.ensure_one()
        return self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'pmo.projects.manage', record=self,
        )

    def _webvue_check_manage(self):
        if not self._webvue_can_manage():
            raise AccessError(self.env._("Only the project manager can change this project."))

    def _webvue_can_create(self):
        service = self.env['webvue.access.service']
        return (
            service._webvue_has_capability(
                self.env.user, 'pmo.projects.create',
            )
            or (
                service._webvue_is_employee_principal(self.env.user)
                and self.env['webvue.pmo.settings']._core_values()['project_creators'] == 'employees'
            )
        )

    def _webvue_write_sudo(self, vals, allowed=MANAGER_WRITABLE):
        """Write project fields in sudo, whitelisted, with NO manage-rule check.

        This is the *do* step only: it trusts the caller already proved the
        write is authorized. It exists separately from _webvue_write_as_manager
        so a *do* step (e.g. _webvue_do_set_status) never re-runs
        _webvue_can_manage after its own check step has already run — an
        overlay that widens a check step (e.g. _webvue_check_status_allowed)
        must not be blocked again here by the unwidened base rule. Odoo's
        project ACL has no notion of "the manager of this project" (only the
        project-manager *group* may write project.project), which is why the
        write itself runs in sudo once the caller has done its own check.
        Third documented sudo() in webvue_pmo (settings, policy create, this).
        """
        self.ensure_one()
        bad = set(vals) - allowed
        if bad:
            msg = f"cannot write non-whitelisted project fields: {sorted(bad)}"
            raise ValueError(msg)
        self.sudo().write(vals)
        return self

    def _webvue_write_as_manager(self, vals):
        """Check the manage rule, then write project fields on the caller's behalf.

        The check-and-write pair for every project-level write webvue performs
        on a manager's behalf outside of a dedicated *do* step. See
        _webvue_write_sudo for the write itself and why a *do* step bypasses
        this check.
        """
        self._webvue_check_manage()
        return self._webvue_write_sudo(vals)

    def _webvue_write_charter_approval(self, vals):
        """The *do* step of a charter transition: approval fields only.

        Documented PMO elevated case (charter approval): the sponsor is not a
        project manager and Odoo's ACL lets only the manager group write
        project.project. Every caller ran its own check first (manager for
        submit/withdraw, sponsor for approve/return).
        """
        return self._webvue_write_sudo(vals, allowed=CHARTER_APPROVAL_FIELDS)

    @api.model
    def _webvue_next_code(self):
        return self.env['ir.sequence'].next_by_code('webvue.project.code') or False

    def _webvue_updated_at(self):
        self.ensure_one()
        return 'v%s' % (self.webvue_revision or 0)

    def _webvue_lock_for_write(self, expected, *, require_manage=True):
        self.ensure_one()
        self.env.cr.execute(
            '''
                SELECT webvue_revision, company_id
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
        self._webvue_check_visible_current()
        if require_manage:
            self._webvue_check_manage()
        current = 'v%s' % (row[0] or 0)
        if expected != current:
            raise WebVueStaleWrite(self.env._("This project was changed by someone else."))

    def _webvue_bump_revision(self):
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE project_project SET webvue_revision = COALESCE(webvue_revision, 0) + 1 WHERE id IN %s',
            [tuple(self.ids)],
        )
        self.invalidate_recordset(['webvue_revision'])

    def _webvue_prepare_charter_vals(self, vals, records=None):
        self._webvue_prepare_json_vals(vals)
        self._webvue_prepare_budget_vals(vals)
        self._webvue_prepare_assignment_vals(vals, records)

    def _webvue_prepare_json_vals(self, vals):
        for field, keys, label in (
            ('webvue_objectives', OBJECTIVE_KEYS, 'objectives'),
            ('webvue_deliverables', DELIVERABLE_KEYS, 'deliverables'),
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

    def _webvue_prepare_budget_vals(self, vals):
        if 'webvue_budget_amount' in vals:
            amount = vals['webvue_budget_amount']
            if isinstance(amount, bool | str):
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if amount is not None and amount is not False:
                if not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                    raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
        if vals.get('webvue_budget_state') != 'unknown':
            return
        if 'webvue_budget_amount' in vals:
            amount = vals['webvue_budget_amount']
            if amount not in (0, 0.0, None, False):
                raise ValidationError(self.env._("Unknown budget amount must be zero."))
        vals['webvue_budget_amount'] = 0.0

    def _webvue_prepare_assignment_vals(self, vals, records=None):
        records = records if records is not None else self.browse()
        if 'webvue_sponsor_id' in vals:
            sponsor = vals['webvue_sponsor_id']
            if sponsor:
                user = self.env['res.users'].with_context(active_test=False).browse(int(sponsor)).exists()
                current_ids = {project.webvue_sponsor_id.id for project in records if project.webvue_sponsor_id}
                current_id = next(iter(current_ids)) if len(current_ids) == 1 else None
                if not self._webvue_eligible_user(user, current_id=current_id):
                    raise ValidationError(self.env._("Sponsor must be an active internal user in the current company."))
        for field, model in (
            ('webvue_type_id', 'webvue.project.type'),
            ('webvue_owning_unit_id', 'webvue.project.owning.unit'),
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

    @api.constrains('webvue_objectives')
    def _check_webvue_objectives(self):
        for project in self:
            _validate_charter_rows(project.webvue_objectives, OBJECTIVE_KEYS, 'objectives')

    @api.constrains('webvue_deliverables')
    def _check_webvue_deliverables(self):
        for project in self:
            _validate_charter_rows(project.webvue_deliverables, DELIVERABLE_KEYS, 'deliverables')

    @api.constrains('webvue_type_id', 'webvue_owning_unit_id', 'company_id')
    def _check_webvue_catalog_company(self):
        for project in self:
            for record in (project.webvue_type_id, project.webvue_owning_unit_id):
                if not record:
                    continue
                if not project.company_id:
                    raise ValidationError(self.env._("A company-less project cannot take a catalog reference."))
                if record.company_id != project.company_id:
                    raise ValidationError(self.env._("Catalog references must belong to the project company."))

    @api.constrains('date_start', 'date')
    def _check_webvue_milestone_bounds(self):
        milestones = self.env['project.milestone'].search([
            ('project_id', 'in', self.ids),
        ])
        milestones._webvue_validate_schedule_bounds()

    @api.constrains('webvue_priority')
    def _check_webvue_priority(self):
        for project in self:
            if project.webvue_priority and project.webvue_priority not in PRIORITY_VALUES:
                raise ValidationError(self.env._("Invalid project priority."))

    @api.constrains('webvue_budget_state', 'webvue_budget_amount')
    def _check_webvue_budget(self):
        for project in self:
            if project.webvue_budget_state not in BUDGET_STATES:
                raise ValidationError(self.env._("Budget state must be unknown or estimate."))
            amount = project.webvue_budget_amount
            if isinstance(amount, bool) or not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if project.webvue_budget_state == 'unknown' and amount:
                raise ValidationError(self.env._("Unknown budget amount must be zero."))
