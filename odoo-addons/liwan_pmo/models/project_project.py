# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo import api, fields, models
from odoo.exceptions import AccessError, MissingError, UserError, ValidationError

from .liwan_settings import CREATORS
from .project_charter import LiwanCharterState
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
    'LiwanCharterState',
    'LiwanStaleWrite',
]

# Kept as a distinct exported name: other liwan_pmo modules import
# PROJECT_CREATORS, not liwan_settings.CREATORS, from here.
PROJECT_CREATORS = CREATORS

# Copy limits of _liwan_copy_structure, kept here as module-level knobs.
MAX_COPY_TASKS = 500
MAX_COPY_MILESTONES = 100


class LiwanStaleWrite(Exception):
    """Write token no longer matches the locked row."""


class ProjectProject(models.Model):
    _inherit = 'project.project'

    liwan_completion_approval = fields.Selection(
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
    liwan_completion_approver_id = fields.Many2one(
        'res.users', string='Completion approver', ondelete='restrict', copy=False, index=True,
    )
    liwan_code = fields.Char(copy=False, index=True)

    liwan_revision = fields.Integer(default=1, required=True, copy=False)
    liwan_type_id = fields.Many2one(
        'liwan.project.type', ondelete='restrict', check_company=True, index=True,
    )
    liwan_owning_unit_id = fields.Many2one(
        'liwan.project.owning.unit', ondelete='restrict', check_company=True, index=True,
    )
    liwan_sponsor_id = fields.Many2one('res.users', ondelete='set null', index=True)
    liwan_authority = fields.Text(default='')
    liwan_rationale = fields.Text(default='')
    liwan_objectives = fields.Json(default=list)
    liwan_benefits = fields.Text(default='')
    liwan_scope = fields.Text(default='')
    liwan_exclusions = fields.Text(default='')
    liwan_high_level_requirements = fields.Text(default='')
    liwan_deliverables = fields.Json(default=list)
    liwan_success = fields.Text(default='')
    liwan_budget_state = fields.Selection(
        [('unknown', 'Unknown'), ('estimate', 'Estimate')],
        default='unknown',
        required=True,
    )
    liwan_budget_amount = fields.Monetary(currency_field='currency_id', default=0.0)
    liwan_priority = fields.Selection([
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ])
    liwan_assumptions = fields.Text(default='')
    liwan_constraints = fields.Text(default='')
    liwan_closure = fields.Text(default='')
    # draft → submitted (waiting for the sponsor) → approved. Only the
    # _liwan_charter_* transitions write these; see CHARTER_APPROVAL_FIELDS.
    liwan_charter_state = fields.Selection(
        [('draft', 'Draft'), ('submitted', 'Submitted'), ('approved', 'Approved')],
        default='draft',
        required=True,
        copy=False,
    )
    liwan_charter_submitted_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    liwan_charter_submitted_at = fields.Datetime(copy=False)
    liwan_charter_approved_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    liwan_charter_approved_at = fields.Datetime(copy=False)
    liwan_charter_return_note = fields.Text(default='', copy=False)

    _liwan_code_uniq = models.Constraint(
        'UNIQUE(liwan_code)',
        'Project code must be unique.',
    )
    _liwan_budget_unknown_zero = models.Constraint(
        "CHECK(liwan_budget_state != 'unknown' OR liwan_budget_amount = 0)",
        'Unknown budget amount must be zero.',
    )
    _liwan_budget_nonnegative = models.Constraint(
        'CHECK(liwan_budget_amount >= 0 AND liwan_budget_amount = liwan_budget_amount)',
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
            self.env['liwan.access.service']._liwan_require_capability(
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
            if not self.env['liwan.access.service']._liwan_has_capability(
                self.env.user, 'pmo.projects.read',
            ):
                return self, lambda: AccessError('forbidden')
        return super()._check_access(operation)

    def _liwan_check_visible_current(self):
        if not self:
            return self
        if any(
            not project.company_id or project.company_id != self.env.company
            for project in self
        ):
            raise AccessError(self.env._("Project is outside the current company."))
        self.check_access('read')
        return self

    def _liwan_is_bootstrap_create(self):
        """Stock superuser install/import compatibility only.

        Not a caller-controlled exemption. Ordinary internal users and
        ``base.group_system`` business API still receive create requirements.
        ``_liwan_create_from_policy`` enforces the same rules before any
        elevated create.
        """
        return bool(
            self.env.is_superuser()
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER),
        )

    def _liwan_resolved_create_vals(self, vals):
        merged = dict(vals)
        ctx = self.env.context
        if 'user_id' not in merged and 'default_user_id' in ctx:
            merged['user_id'] = ctx['default_user_id']
        if 'date' not in merged and 'default_date' in ctx:
            merged['date'] = ctx['default_date']
        if 'liwan_completion_approval' not in merged:
            if 'default_liwan_completion_approval' in ctx:
                merged['liwan_completion_approval'] = ctx['default_liwan_completion_approval']
            else:
                merged['liwan_completion_approval'] = self.env['liwan.pmo.settings']._core_values()[
                    'default_completion_approval'
                ]
        if 'liwan_completion_approver_id' not in merged and 'default_liwan_completion_approver_id' in ctx:
            merged['liwan_completion_approver_id'] = ctx['default_liwan_completion_approver_id']
        if 'user_id' not in merged:
            merged['user_id'] = self.env.uid
        if 'company_id' not in merged:
            merged['company_id'] = self.env.company.id
        return merged

    def _liwan_check_create_requirements(self, vals):
        settings = self.env['liwan.pmo.settings']._core_values()
        manager_id = vals.get('user_id')
        if settings['require_manager_on_create'] and not manager_id:
            raise UserError(self.env._("A project manager is required to create a project."))
        if manager_id:
            self._liwan_check_manager_user(self.env['res.users'].browse(manager_id).exists())
        if settings['require_end_date_on_create'] and not vals.get('date'):
            raise UserError(self.env._("An end date is required to create a project."))
        mode = vals.get('liwan_completion_approval', 'none')
        if mode not in COMPLETION_APPROVAL_VALUES:
            raise UserError(self.env._("Unknown completion approval mode."))
        if mode == 'specific_user' and not vals.get('liwan_completion_approver_id'):
            raise UserError(self.env._("A specific approver is required."))
        if mode != 'specific_user' and vals.get('liwan_completion_approver_id'):
            raise UserError(self.env._("A specific approver is only valid for specific_user mode."))

    def _liwan_check_manager_user(self, user):
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
        bootstrap = self._liwan_is_bootstrap_create() and not policy_create
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
                if not self._liwan_can_create():
                    raise AccessError(self.env._("You are not allowed to create projects."))
            if not policy_create and not self.env.is_superuser():
                vals.pop('liwan_code', None)
            if 'liwan_revision' in vals:
                raise AccessError(self.env._("Project revision cannot be set."))
            self._liwan_prepare_charter_vals(vals)
            if not bootstrap:
                vals = self._liwan_resolved_create_vals(vals)
                self._liwan_check_create_requirements(vals)
            prepared.append(vals)
        if prepared:
            self.env['liwan.entitlement.service']._liwan_claim_projects(len(prepared))
        projects = super().create(prepared)
        if not bootstrap:
            for project in projects:
                if project.liwan_completion_approval == 'specific_user':
                    project._liwan_check_approver_eligible(project.liwan_completion_approver_id)
        return projects

    def _liwan_write_vals(self, vals):
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
        # (addons/project/models/project_project.py:666-679). LiwanOS authorization
        # already ran. Do not use models.Model.write/_write/raw SQL.
        return super(StockProjectProject, missing_start).write({'date': vals['date']}) and result

    def write(self, vals):
        vals = dict(vals)
        if 'liwan_revision' in vals:
            raise AccessError(self.env._("Project revision cannot be set."))
        if 'liwan_code' in vals and not self.env.is_superuser():
            raise AccessError(self.env._("Project code cannot be set."))
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            self._liwan_check_visible_current()
            if set(vals) - MANAGER_WRITABLE:
                raise AccessError(self.env._("Project fields are not allowed."))
            if any(not project._liwan_can_manage() for project in self):
                raise AccessError(self.env._("Only the project manager can change this project."))
        policy_changed = 'liwan_completion_approval' in vals or 'liwan_completion_approver_id' in vals
        manager_changed = 'user_id' in vals
        archived = vals.get('active') is False
        restored = vals.get('active') is True
        old_modes = {project.id: project.liwan_completion_approval for project in self}
        if policy_changed or manager_changed or archived:
            pending = self.env['project.task'].sudo().search([
                ('project_id', 'in', self.ids),
                ('liwan_completion_pending', '=', True),
            ])
            self.env['project.task']._liwan_lock_projects_then_tasks(self, pending)
            self.invalidate_recordset()
            pending.invalidate_recordset()
        if policy_changed:
            self._liwan_check_completion_policy_vals(vals)
        self._liwan_prepare_charter_vals(vals, records=self)
        reopen = self._liwan_charter_guard(vals)
        if restored:
            inactive = self.filtered(lambda project: not project.active)
            if inactive:
                self.env['liwan.entitlement.service']._liwan_claim_projects(len(inactive))
        elif archived:
            active = self.filtered(lambda project: project.active)
            if active:
                self.env['liwan.entitlement.service']._liwan_claim_projects(-len(active))
        content = set(vals) & REVISION_CONTENT_FIELDS
        result = self._liwan_write_vals(vals)
        if content and self.ids:
            self._liwan_bump_revision()
        if policy_changed or archived:
            self._liwan_invalidate_completion_requests()
        elif manager_changed:
            stale = self.filtered(
                lambda project: old_modes.get(project.id) == 'project_manager'
                or project.liwan_completion_approval == 'project_manager',
            )
            if stale:
                stale._liwan_invalidate_completion_requests()
        for project in reopen:
            project._liwan_write_charter_approval(dict(CHARTER_RESET_VALS))
        if vals.get('privacy_visibility') == 'followers':
            # A waiting sponsor must keep read access when the project turns private.
            for project in self.filtered(lambda p: p.liwan_charter_state == 'submitted'):
                sponsor = project.liwan_sponsor_id
                if sponsor and project._liwan_can_manage() and sponsor not in project._liwan_followers():
                    project._liwan_add_follower(sponsor)
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
    def _liwan_is_admin(self):
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'pmo.projects.manage',
        )

    def _liwan_is_manager(self):
        """Group-level rule: project managers and customer admins (any project)."""
        return self._liwan_is_admin()

    def _liwan_can_manage(self):
        """Per-project rule: the group rule OR being this project's assigned manager."""
        self.ensure_one()
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'pmo.projects.manage', record=self,
        )

    def _liwan_is_member(self):
        """Whether the caller works on this project: manages or sponsors it, follows it or holds one of its tasks."""
        self.ensure_one()
        user = self.env.user
        if self._liwan_can_manage() or user == self.liwan_sponsor_id or user in self._liwan_followers():
            return True
        return bool(self.env['project.task'].with_context(active_test=False).search_count(
            [('project_id', '=', self.id), ('user_ids', 'in', user.id)], limit=1,
        ))

    def _liwan_check_archived_readable(self):
        """An archived project is read from its link by its members; anyone else gets not-found."""
        self.ensure_one()
        if not self.active and not self._liwan_is_member():
            raise MissingError(self.env._("Record does not exist"))

    def _liwan_check_manage(self):
        if not self._liwan_can_manage():
            raise AccessError(self.env._("Only the project manager can change this project."))

    def _liwan_can_create(self):
        service = self.env['liwan.access.service']
        return (
            service._liwan_has_capability(
                self.env.user, 'pmo.projects.create',
            )
            or (
                service._liwan_is_employee_principal(self.env.user)
                and self.env['liwan.pmo.settings']._core_values()['project_creators'] == 'employees'
            )
        )

    def _liwan_write_sudo(self, vals, allowed=MANAGER_WRITABLE):
        """Write project fields in sudo, whitelisted, with NO manage-rule check.

        This is the *do* step only: it trusts the caller already proved the
        write is authorized. It exists separately from _liwan_write_as_manager
        so a *do* step (e.g. _liwan_do_set_status) never re-runs
        _liwan_can_manage after its own check step has already run — an
        overlay that widens a check step (e.g. _liwan_check_status_allowed)
        must not be blocked again here by the unwidened base rule. Odoo's
        project ACL has no notion of "the manager of this project" (only the
        project-manager *group* may write project.project), which is why the
        write itself runs in sudo once the caller has done its own check.
        Third documented sudo() in liwan_pmo (settings, policy create, this).
        """
        self.ensure_one()
        bad = set(vals) - allowed
        if bad:
            msg = f"cannot write non-whitelisted project fields: {sorted(bad)}"
            raise ValueError(msg)
        self.sudo().write(vals)
        return self

    def _liwan_write_as_manager(self, vals):
        """Check the manage rule, then write project fields on the caller's behalf.

        The check-and-write pair for every project-level write liwan performs
        on a manager's behalf outside of a dedicated *do* step. See
        _liwan_write_sudo for the write itself and why a *do* step bypasses
        this check.
        """
        self._liwan_check_manage()
        return self._liwan_write_sudo(vals)

    def _liwan_write_charter_approval(self, vals):
        """The *do* step of a charter transition: approval fields only.

        Documented PMO elevated case (charter approval): the sponsor is not a
        project manager and Odoo's ACL lets only the manager group write
        project.project. Every caller ran its own check first (manager for
        submit/withdraw, sponsor for approve/return).
        """
        return self._liwan_write_sudo(vals, allowed=CHARTER_APPROVAL_FIELDS)

    @api.model
    def _liwan_next_code(self):
        return self.env['ir.sequence'].next_by_code('liwan.project.code') or False

    def _liwan_updated_at(self):
        self.ensure_one()
        return 'v%s' % (self.liwan_revision or 0)

    def _liwan_lock_for_write(self, expected, *, require_manage=True):
        self.ensure_one()
        self.env.cr.execute(
            '''
                SELECT liwan_revision, company_id
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
        self._liwan_check_visible_current()
        if require_manage:
            self._liwan_check_manage()
        current = 'v%s' % (row[0] or 0)
        if expected != current:
            raise LiwanStaleWrite(self.env._("This project was changed by someone else."))

    def _liwan_bump_revision(self):
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE project_project SET liwan_revision = COALESCE(liwan_revision, 0) + 1 WHERE id IN %s',
            [tuple(self.ids)],
        )
        self.invalidate_recordset(['liwan_revision'])

    def _liwan_prepare_charter_vals(self, vals, records=None):
        self._liwan_prepare_json_vals(vals)
        self._liwan_prepare_budget_vals(vals)
        self._liwan_prepare_assignment_vals(vals, records)

    def _liwan_prepare_json_vals(self, vals):
        for field, keys, label in (
            ('liwan_objectives', OBJECTIVE_KEYS, 'objectives'),
            ('liwan_deliverables', DELIVERABLE_KEYS, 'deliverables'),
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

    def _liwan_prepare_budget_vals(self, vals):
        if 'liwan_budget_amount' in vals:
            amount = vals['liwan_budget_amount']
            if isinstance(amount, bool | str):
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if amount is not None and amount is not False:
                if not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                    raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
        if vals.get('liwan_budget_state') != 'unknown':
            return
        if 'liwan_budget_amount' in vals:
            amount = vals['liwan_budget_amount']
            if amount not in (0, 0.0, None, False):
                raise ValidationError(self.env._("Unknown budget amount must be zero."))
        vals['liwan_budget_amount'] = 0.0

    def _liwan_prepare_assignment_vals(self, vals, records=None):
        records = records if records is not None else self.browse()
        if 'liwan_sponsor_id' in vals:
            sponsor = vals['liwan_sponsor_id']
            if sponsor:
                user = self.env['res.users'].with_context(active_test=False).browse(int(sponsor)).exists()
                current_ids = {project.liwan_sponsor_id.id for project in records if project.liwan_sponsor_id}
                current_id = next(iter(current_ids)) if len(current_ids) == 1 else None
                if not self._liwan_eligible_user(user, current_id=current_id):
                    raise ValidationError(self.env._("Sponsor must be an active internal user in the current company."))
        for field, model in (
            ('liwan_type_id', 'liwan.project.type'),
            ('liwan_owning_unit_id', 'liwan.project.owning.unit'),
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

    @api.constrains('liwan_objectives')
    def _check_liwan_objectives(self):
        for project in self:
            _validate_charter_rows(project.liwan_objectives, OBJECTIVE_KEYS, 'objectives')

    @api.constrains('liwan_deliverables')
    def _check_liwan_deliverables(self):
        for project in self:
            _validate_charter_rows(project.liwan_deliverables, DELIVERABLE_KEYS, 'deliverables')

    @api.constrains('liwan_type_id', 'liwan_owning_unit_id', 'company_id')
    def _check_liwan_catalog_company(self):
        for project in self:
            for record in (project.liwan_type_id, project.liwan_owning_unit_id):
                if not record:
                    continue
                if not project.company_id:
                    raise ValidationError(self.env._("A company-less project cannot take a catalog reference."))
                if record.company_id != project.company_id:
                    raise ValidationError(self.env._("Catalog references must belong to the project company."))

    @api.constrains('date_start', 'date')
    def _check_liwan_milestone_bounds(self):
        milestones = self.env['project.milestone'].search([
            ('project_id', 'in', self.ids),
        ])
        milestones._liwan_validate_schedule_bounds()

    @api.constrains('liwan_priority')
    def _check_liwan_priority(self):
        for project in self:
            if project.liwan_priority and project.liwan_priority not in PRIORITY_VALUES:
                raise ValidationError(self.env._("Invalid project priority."))

    @api.constrains('liwan_budget_state', 'liwan_budget_amount')
    def _check_liwan_budget(self):
        for project in self:
            if project.liwan_budget_state not in BUDGET_STATES:
                raise ValidationError(self.env._("Budget state must be unknown or estimate."))
            amount = project.liwan_budget_amount
            if isinstance(amount, bool) or not isinstance(amount, int | float) or not math.isfinite(amount) or amount < 0:
                raise ValidationError(self.env._("Budget amount must be a finite non-negative number."))
            if project.liwan_budget_state == 'unknown' and amount:
                raise ValidationError(self.env._("Unknown budget amount must be zero."))
