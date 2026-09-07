# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from odoo.addons.project.models.project_task import CLOSED_STATES

MANAGER_STATES = {'03_approved', '02_changes_requested'}
ALL_STATES = {'01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', *CLOSED_STATES}
DONE_STATE = '1_done'
TASK_CREATE_MARKER = 'nasq_pmo.task_create_depth'
ACCESS_USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'
DEPENDENCY_WRITE_MARKER = 'nasq_pmo.dependency_write_depth'
SCHEDULE_WRITE_MARKER = 'nasq_pmo.schedule_write_depth'
COMPLETION_ACCEPT_IDS = 'nasq_pmo.completion_accept_ids'
COMPLETION_META_IDS = 'nasq_pmo.completion_meta_ids'
APPROVAL_WRITE_FIELDS = {'state', 'date_end', 'date_last_stage_update'}
COMPLETION_META_FIELDS = {
    'nasq_completion_pending', 'nasq_completion_revision',
    'nasq_completion_requested_by', 'nasq_completion_requested_at',
    'nasq_completion_return_note',
}
COMPLETION_PRISTINE = {
    'nasq_completion_pending': False,
    'nasq_completion_revision': 0,
    'nasq_completion_requested_by': False,
    'nasq_completion_requested_at': False,
    'nasq_completion_return_note': False,
}
TASK_WRITABLE_FIELDS = {
    'active', 'allocated_hours', 'date_deadline', 'date_end', 'date_last_stage_update',
    'description', 'milestone_id', 'name', 'personal_stage_type_id', 'priority',
    'stage_id', 'state', 'tag_ids', 'user_ids',
}
TASK_CREATE_FIELDS = TASK_WRITABLE_FIELDS | {'parent_id', 'project_id'}


class ProjectTask(models.Model):
    _inherit = 'project.task'

    nasq_completion_pending = fields.Boolean(default=False, copy=False, index=True)
    nasq_completion_revision = fields.Integer(default=0, copy=False)
    nasq_completion_requested_by = fields.Many2one('res.users', copy=False, ondelete='set null')
    nasq_completion_requested_at = fields.Datetime(copy=False)
    nasq_completion_return_note = fields.Text(copy=False)
    nasq_planned_start = fields.Date(copy=False, index=True)

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
                'pmo.tasks.read',
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
                'pmo.tasks.read',
            )
        return super().check_access(operation)

    def _nasq_check_visible_current(self):
        if not self:
            return self
        if any(
            task.company_id and task.company_id != self.env.company
            for task in self
        ):
            raise AccessError(self.env._("Task is outside the current company."))
        self.check_access('read')
        return self

    def _nasq_can_approve(self):
        """True when the current user may use the broad approve / request-changes states."""
        self.ensure_one()
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.tasks.approve', record=self,
        )

    def _nasq_completion_required(self):
        self.ensure_one()
        project = self.project_id
        return bool(project and project.nasq_completion_approval != 'none')

    def _nasq_completion_reviewer(self):
        self.ensure_one()
        return self.project_id._nasq_completion_reviewer() if self.project_id else self.env['res.users']

    def _nasq_task_is_open_for_completion(self):
        self.ensure_one()
        return bool(
            self.active
            and not self.is_closed
            and self.project_id
            and self.project_id.active,
        )

    def _nasq_can_request_completion(self):
        self.ensure_one()
        return bool(
            self._nasq_completion_required()
            and self._nasq_task_is_open_for_completion()
            and not self.nasq_completion_pending
            and self._nasq_can_write()
            and self.env.user in self.user_ids,
        )

    def _nasq_can_decide_completion(self):
        self.ensure_one()
        if (
            not self._nasq_completion_required()
            or not self.nasq_completion_pending
            or not self._nasq_task_is_open_for_completion()
        ):
            return False
        return self._nasq_reviewer_is_current()

    def _nasq_can_withdraw_completion(self):
        self.ensure_one()
        return bool(
            self._nasq_task_is_open_for_completion()
            and self.nasq_completion_pending
            and self.nasq_completion_requested_by == self.env.user
            and self._nasq_can_write(),
        )

    def _nasq_reviewer_eligible(self, user):
        self.ensure_one()
        if not user or not user.active or user.share:
            return False
        # This is a boolean eligibility boundary, not a foreign-company read.
        # Caller-context traversal can raise on res.company record rules and
        # break task serialization before it can report reviewer_ineligible.
        if self.env.company.id not in user.sudo().company_ids.ids:
            return False
        try:
            self.with_user(user).with_company(self.env.company)._nasq_check_visible_current()
            if self.project_id:
                self.project_id.with_user(user).with_company(self.env.company)._nasq_check_visible_current()
        except AccessError:
            return False
        return self.env['nasq.access.service']._nasq_has_capability(
            user, 'pmo.tasks.approve', record=self,
        )

    def _nasq_reviewer_is_current(self):
        self.ensure_one()
        reviewer = self._nasq_completion_reviewer()
        return bool(reviewer and reviewer == self.env.user and self._nasq_reviewer_eligible(reviewer))

    def _nasq_completion_blocked_reason(self):
        self.ensure_one()
        if not self._nasq_completion_required() or self.is_closed or not self.active:
            return None
        if self.project_id and not self.project_id.active:
            return None
        reviewer = self._nasq_completion_reviewer()
        if not reviewer:
            return 'no_reviewer'
        if not self._nasq_reviewer_eligible(reviewer):
            return 'reviewer_ineligible'
        return None

    def _nasq_allowed_transitions(self):
        self.ensure_one()
        api_to_state = {
            'in_progress': '01_in_progress',
            'changes_requested': '02_changes_requested',
            'approved': '03_approved',
            'waiting': '04_waiting_normal',
            'done': '1_done',
            'cancelled': '1_canceled',
        }
        state_to_api = {odoo: api for api, odoo in api_to_state.items()}
        current = state_to_api.get(self.state)
        allowed = []
        can_write = self._nasq_can_write()
        can_approve = self._nasq_can_approve()
        required = self._nasq_completion_required()
        for api_state, odoo_state in api_to_state.items():
            if api_state == current:
                continue
            if odoo_state in MANAGER_STATES and not can_approve:
                continue
            if odoo_state == DONE_STATE and required:
                continue
            if not can_write and not (can_approve and odoo_state in MANAGER_STATES):
                continue
            allowed.append(api_state)
        return allowed

    def _nasq_can_write(self):
        self.ensure_one()
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.tasks.write', record=self,
        )

    def _nasq_can_archive(self):
        self.ensure_one()
        return self._nasq_can_write() and (
            self.create_uid == self.env.user or self._nasq_can_approve()
        )

    def _nasq_can_manage_dependencies(self):
        self.ensure_one()
        project = self.project_id
        return bool(
            project
            and project.active
            and project.company_id == self.env.company
            and project._nasq_can_manage(),
        )

    def _nasq_can_manage_schedule(self):
        self.ensure_one()
        project = self.project_id
        return bool(
            project
            and project.active
            and project.company_id == self.env.company
            and project._nasq_can_manage(),
        )

    def _nasq_set_schedule(self, start, end):
        """Set the date-only schedule pair after its dedicated manager check.

        This is intentionally separate from generic task writes. Template and
        schedule callers use this checked mutation path, while direct ORM/RPC
        writes cannot manufacture the internal marker used below.
        """
        self.ensure_one()
        self._nasq_check_visible_current()
        project = self.project_id
        if not project or not project.active or project.company_id != self.env.company:
            raise AccessError(self.env._("Scheduling requires an active current-company project."))
        project._nasq_check_visible_current()
        if not self._nasq_can_manage_schedule():
            raise AccessError(self.env._("Only the project manager can change task scheduling."))
        for value, label in ((start, 'start'), (end, 'end')):
            if value is not False and value is not None and (
                not isinstance(value, date) or isinstance(value, datetime)
            ):
                raise ValidationError(self.env._("Schedule %(field)s must be a calendar date or empty.", field=label))
        start = start or False
        end = end or False
        if bool(start) != bool(end):
            raise ValidationError(self.env._("Schedule start and end must be set together."))
        if start and end and start > end:
            raise ValidationError(self.env._("Schedule start must be on or before the end date."))
        marker = self.env.cr.precommit.data
        previous_depth = marker.get(SCHEDULE_WRITE_MARKER)
        marker[SCHEDULE_WRITE_MARKER] = (previous_depth or 0) + 1
        try:
            self.write({
                'nasq_planned_start': start,
                'date_deadline': fields.Datetime.to_datetime(end) if end else False,
            })
        finally:
            if previous_depth is None:
                marker.pop(SCHEDULE_WRITE_MARKER, None)
            else:
                marker[SCHEDULE_WRITE_MARKER] = previous_depth
        return self

    def _nasq_set_dependencies(self, ids):
        """Replace prerequisites after the project-scoped manage check.

        ``depend_on_ids`` is intentionally absent from TASK_WRITABLE_FIELDS;
        this operation has its own project-manager capability and validation
        boundary rather than becoming a generic task write field.
        """
        self.ensure_one()
        self._nasq_check_visible_current()
        project = self.project_id
        if not project or not project.active or project.company_id != self.env.company:
            raise ValidationError(self.env._("Dependencies require an active current-company project."))
        if not self._nasq_can_manage_dependencies():
            raise AccessError(self.env._("Only the project manager can change task dependencies."))
        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in ids):
            raise ValidationError(self.env._("Dependency ids must be positive integers."))
        if not project.allow_task_dependencies and ids:
            raise ValidationError(self.env._("Task dependencies are disabled for this project."))
        if len(ids) != len(set(ids)):
            raise ValidationError(self.env._("Dependency ids must be unique."))
        candidates = self.env['project.task'].search([
            ('id', 'in', ids),
            ('active', '=', True),
            ('company_id', '=', self.env.company.id),
            ('project_id', '=', project.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', self.env.company.id),
        ])
        if len(candidates) != len(ids):
            raise ValidationError(self.env._("Dependencies must belong to the same readable project."))
        candidates._nasq_check_visible_current()
        if self.id in candidates.ids:
            raise ValidationError(self.env._("A task cannot depend on itself."))
        all_tasks = self.env['project.task'].with_context(active_test=False).search([
            ('company_id', '=', self.env.company.id),
            ('project_id', '=', project.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', self.env.company.id),
        ])
        dependency_graph = {
            task.id: set(task.depend_on_ids.ids) & set(all_tasks.ids)
            for task in all_tasks
        }
        pending = list(ids)
        visited = set()
        while pending:
            dependency_id = pending.pop()
            if dependency_id == self.id:
                raise ValidationError(self.env._("Task dependencies cannot contain a cycle."))
            if dependency_id in visited:
                continue
            visited.add(dependency_id)
            pending.extend(dependency_graph.get(dependency_id, ()))
        marker = self.env.cr.precommit.data
        previous_depth = marker.get(DEPENDENCY_WRITE_MARKER)
        marker[DEPENDENCY_WRITE_MARKER] = (previous_depth or 0) + 1
        try:
            self.write({'depend_on_ids': [(6, 0, ids)]})
        finally:
            if previous_depth is None:
                marker.pop(DEPENDENCY_WRITE_MARKER, None)
            else:
                marker[DEPENDENCY_WRITE_MARKER] = previous_depth
        return self

    def _nasq_archive(self):
        self.ensure_one()
        if not self._nasq_can_archive():
            raise AccessError(self.env._("Only the project manager or the task's creator can archive it."))
        self.write({'active': False})
        return self

    def _nasq_transition(self, state):
        """Move ``self`` to ``state`` (Odoo code) applying nasq's approval rule.

        Decomposed into hooks so customer overlays override one step.
        """
        if state not in ALL_STATES:
            raise ValueError(f"unknown task state {state!r}")
        self._nasq_check_transition_allowed(state)
        self._nasq_do_transition(state)
        self._nasq_post_transition_hook(state)
        return self

    def _nasq_check_transition_allowed(self, state):
        """Raise AccessError when the current user may not move to ``state``."""
        if state in MANAGER_STATES and not self._nasq_can_approve():
            raise AccessError(self.env._("Only a project manager can approve or request changes."))
        if state == DONE_STATE:
            accept_ids = self._nasq_accept_ids()
            if any(task._nasq_completion_required() and task.id not in accept_ids for task in self):
                raise AccessError(self.env._("This task requires completion approval."))

    def _nasq_do_transition(self, state):
        """Write ``state`` and keep ``date_end`` consistent: set on close, cleared on reopen."""
        if state in CLOSED_STATES:
            self.write({'state': state, 'date_end': fields.Datetime.now()})
            return
        reopened = self.filtered(lambda t: t.state in CLOSED_STATES)
        (self - reopened).write({'state': state})
        reopened.write({'state': state, 'date_end': False})

    def _nasq_post_transition_hook(self, state):
        """Extension point (notifications, side effects). No-op in core."""

    def _nasq_notify(self, event, extra_partners=None):
        # A single user action can re-enter write() (e.g. project.task's own
        # write() override does a plain `task.date_last_stage_update = now`
        # assignment when 'state' changes, which for a stored field triggers
        # a second, independent records.write() call that recurses through
        # the whole write() stack, including this override) and end up
        # calling _nasq_notify() more than once for what is really one
        # user action. Rather than emit immediately, accumulate
        # (partner_id, task_id, event) triples on the cursor's precommit
        # data and drain them once, right before commit, deduplicated by
        # set membership — the same idiom bus.bus._sendone()/_ensure_hooks()
        # itself uses (see addons/bus/models/bus.py) to batch its own
        # notifications until precommit time.
        precommit = self.env.cr.precommit
        key = 'nasq_pmo.task_notifications'
        if key not in precommit.data:
            precommit.data[key] = set()

            @precommit.add
            def _flush_nasq_notifications():
                pending = precommit.data.pop(key, ())
                if not pending:
                    return
                bus = self.env['bus.bus']
                for partner_id, task_id, evt in pending:
                    bus._sendone(
                        self.env['res.partner'].browse(partner_id),
                        'nasq/task',
                        {'id': task_id, 'event': evt},
                    )

        pending = precommit.data[key]
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                pending.add((partner.id, task.id, event))

    def _nasq_vals_with_defaults(self, vals):
        merged = dict(vals)
        ctx = self.env.context
        if 'state' not in merged and ctx.get('default_state'):
            merged['state'] = ctx['default_state']
        if 'project_id' not in merged and ctx.get('default_project_id'):
            merged['project_id'] = ctx['default_project_id']
        if 'parent_id' not in merged and ctx.get('default_parent_id'):
            merged['parent_id'] = ctx['default_parent_id']
        return merged

    def _nasq_validate_schedule_invariant(self):
        for task in self:
            start = task.nasq_planned_start
            end = fields.Date.to_date(task.date_deadline) if task.date_deadline else False
            if start and (not end or start > end):
                raise ValidationError(self.env._(
                    "Schedule start and end must be set together, with start on or before the end date.",
                ))
        return self

    def _nasq_accept_ids(self):
        return set(self.env.cr.precommit.data.get(COMPLETION_ACCEPT_IDS) or ())

    def _nasq_reject_unauthorized_done(self, tasks):
        accept_ids = self._nasq_accept_ids()
        illegal = tasks.filtered(
            lambda task: task.state == DONE_STATE
            and task._nasq_completion_required()
            and task.id not in accept_ids,
        )
        if illegal:
            raise AccessError(self.env._("This task requires completion approval."))

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._nasq_vals_with_defaults(vals) for vals in vals_list]
        trusted = (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        )
        if not trusted:
            service = self.env['nasq.access.service']
            for vals in vals_list:
                if set(vals) - TASK_CREATE_FIELDS:
                    raise AccessError(self.env._("Task fields are not allowed."))
                parent = self.browse(vals.get('parent_id')).exists()
                if parent:
                    parent._nasq_check_visible_current()
                project = self.env['project.project'].browse(
                    vals.get('project_id'),
                ).exists()
                if not project and parent:
                    project = parent.project_id
                if not project:
                    raise AccessError(self.env._("A visible current-company project is required."))
                project._nasq_check_visible_current()
                if parent and parent.project_id != project:
                    raise AccessError(self.env._("Parent task must belong to the same project."))
                service._nasq_require_capability('pmo.tasks.create', record=project)
                if vals.get('state') in MANAGER_STATES:
                    service._nasq_require_capability('pmo.tasks.approve', record=project)
                if vals.get('state') == DONE_STATE and project.nasq_completion_approval != 'none':
                    raise AccessError(self.env._("This task requires completion approval."))
        # Context default_* and copy/batch must not manufacture a pending request.
        vals_list = [{**vals, **COMPLETION_PRISTINE} for vals in vals_list]
        marker = self.env.cr.precommit.data
        marker[TASK_CREATE_MARKER] = marker.get(TASK_CREATE_MARKER, 0) + 1
        try:
            tasks = super().create(vals_list)
        finally:
            marker[TASK_CREATE_MARKER] -= 1
            if not marker[TASK_CREATE_MARKER]:
                marker.pop(TASK_CREATE_MARKER, None)
        # Stock project.task.create applies ``default_*`` context values after
        # this model's whitelist. The planned start is a manager-only schedule
        # operation, so a caller cannot smuggle it through default_get (or a
        # copied/batched create) even when the requested range is valid.
        if not self.env.is_superuser() and tasks.filtered('nasq_planned_start'):
            raise AccessError(self.env._(
                "Task scheduling must use the dedicated schedule operation.",
            ))
        self._nasq_reject_unauthorized_done(tasks)
        tasks._nasq_validate_schedule_invariant()
        dirty = tasks.filtered(
            lambda task: (
                task.nasq_completion_pending
                or task.nasq_completion_revision
                or task.nasq_completion_requested_by
                or task.nasq_completion_requested_at
                or task.nasq_completion_return_note
            ),
        )
        if dirty:
            raise AccessError(self.env._("Completion metadata cannot be set on create."))
        tasks._nasq_notify('created')
        return tasks

    def write(self, vals):
        dependency_write = (
            self.env.cr.precommit.data.get(DEPENDENCY_WRITE_MARKER)
            and set(vals) <= {'depend_on_ids'}
        )
        meta_ids = set(self.env.cr.precommit.data.get(COMPLETION_META_IDS) or ())
        completion_meta_write = bool(
            self.ids
            and meta_ids
            and set(self.ids) <= meta_ids
            and set(vals) <= COMPLETION_META_FIELDS,
        )
        schedule_write = bool(
            self.ids
            and self.env.cr.precommit.data.get(SCHEDULE_WRITE_MARKER)
            and set(vals) <= {'nasq_planned_start', 'date_deadline'}
        )
        accept_ids = self._nasq_accept_ids()
        accept_write = bool(
            self.ids
            and accept_ids
            and set(self.ids) <= accept_ids
            and set(vals) <= APPROVAL_WRITE_FIELDS,
        )
        trusted = (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(TASK_CREATE_MARKER)
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            or dependency_write
            or schedule_write
            or completion_meta_write
            or accept_write
        )
        if not trusted:
            self._nasq_check_visible_current()
            if set(vals) - TASK_WRITABLE_FIELDS:
                raise AccessError(self.env._("Task fields are not allowed."))
            if 'active' in vals and any(not task._nasq_can_archive() for task in self):
                raise AccessError(self.env._(
                    "Only the project manager or the task's creator can archive it.",
                ))
            approval_write = vals.get('state') in MANAGER_STATES
            if approval_write and any(not task._nasq_can_approve() for task in self):
                raise AccessError(self.env._("Only a project manager can approve or request changes."))
            if (not approval_write or set(vals) - APPROVAL_WRITE_FIELDS) and any(
                not task._nasq_can_write() for task in self
            ):
                raise AccessError(self.env._("You are not allowed to change this task."))
        if not schedule_write:
            if 'nasq_planned_start' in vals:
                raise AccessError(self.env._("Task scheduling must use the dedicated schedule operation."))
            if 'date_deadline' in vals:
                deadline = fields.Date.to_date(vals['date_deadline']) if vals['date_deadline'] else False
                if any(
                    task.nasq_planned_start and (
                        not deadline or task.nasq_planned_start > deadline
                    )
                    for task in self
                ):
                    raise ValidationError(self.env._("Schedule start must be on or before the end date."))
        if vals.get('state') == DONE_STATE:
            unauthorized = self.filtered(
                lambda task: task._nasq_completion_required() and task.id not in accept_ids,
            )
            if unauthorized:
                raise AccessError(self.env._("This task requires completion approval."))
        clears_request = (
            not completion_meta_write
            and (
                vals.get('state') in CLOSED_STATES
                or (vals.get('state') and vals['state'] not in CLOSED_STATES)
                or vals.get('active') is False
                or 'user_ids' in vals
            )
        )
        if clears_request and self.filtered('nasq_completion_pending'):
            self._nasq_lock_projects_then_tasks(self.mapped('project_id'), self)
            self.invalidate_recordset()
            self.mapped('project_id').invalidate_recordset()
        before = {task.id: task.user_ids.partner_id for task in self}
        res = super().write(vals)
        if vals.get('state') == DONE_STATE:
            self._nasq_reject_unauthorized_done(self)
        if not completion_meta_write:
            if vals.get('state') or vals.get('active') is False:
                pending = self.filtered('nasq_completion_pending')
                if pending:
                    pending._nasq_clear_completion_request(invalidate=True)
            if 'user_ids' in vals:
                for task in self.filtered('nasq_completion_pending'):
                    requester = task.nasq_completion_requested_by
                    if requester and requester not in task.user_ids:
                        task._nasq_clear_completion_request(invalidate=True)
        self._nasq_notify('updated', extra_partners=before)
        return res

    def _nasq_write_completion_meta(self, vals):
        marker = self.env.cr.precommit.data
        previous = set(marker.get(COMPLETION_META_IDS) or ())
        authorized = set(previous)
        authorized.update(self.ids)
        marker[COMPLETION_META_IDS] = authorized
        try:
            self.write(vals)
        finally:
            marker[COMPLETION_META_IDS] = previous
            if not previous:
                marker.pop(COMPLETION_META_IDS, None)
        return self

    def _nasq_clear_completion_request(self, note=None, invalidate=False):
        for task in self:
            values = {
                'nasq_completion_pending': False,
                'nasq_completion_requested_by': False,
                'nasq_completion_requested_at': False,
            }
            if note is not None:
                values['nasq_completion_return_note'] = note
            if invalidate:
                values['nasq_completion_revision'] = task.nasq_completion_revision + 1
            task._nasq_write_completion_meta(values)
        return self

    @api.model
    def _nasq_lock_projects_then_tasks(self, projects, tasks):
        """Lock PROJECT then TASK by sorted id. Never task-then-project."""
        for project_id in sorted(project_id for project_id in projects.ids if project_id):
            self.env.cr.execute(
                'SELECT id FROM project_project WHERE id = %s FOR UPDATE',
                [project_id],
            )
        for task_id in sorted(tasks.ids):
            self.env.cr.execute(
                'SELECT id FROM project_task WHERE id = %s FOR UPDATE',
                [task_id],
            )

    def _nasq_lock_completion(self):
        self.ensure_one()
        self._nasq_lock_projects_then_tasks(self.project_id, self)

    def _nasq_request_completion(self):
        self.ensure_one()
        self._nasq_check_visible_current()
        self._nasq_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not self._nasq_can_request_completion():
            raise AccessError(self.env._("You cannot request completion for this task."))
        reviewer = self._nasq_completion_reviewer()
        if not reviewer or not self._nasq_reviewer_eligible(reviewer):
            raise UserError(self.env._("There is no eligible reviewer for this task."))
        return self._nasq_write_completion_meta({
            'nasq_completion_pending': True,
            'nasq_completion_revision': self.nasq_completion_revision + 1,
            'nasq_completion_requested_by': self.env.uid,
            'nasq_completion_requested_at': fields.Datetime.now(),
            'nasq_completion_return_note': False,
        })

    def _nasq_check_completion_decision(self, revision):
        self.ensure_one()
        self._nasq_check_visible_current()
        self._nasq_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise UserError(self.env._("A completion revision is required."))
        if not self._nasq_task_is_open_for_completion():
            raise UserError(self.env._("This task is not open for a completion decision."))
        if not self.nasq_completion_pending:
            raise UserError(self.env._("There is no pending completion request."))
        if revision != self.nasq_completion_revision:
            raise UserError(self.env._("This completion request is stale."))
        if not self._nasq_reviewer_is_current():
            raise AccessError(self.env._("Only the designated reviewer can decide this request."))

    def _nasq_accept_completion(self, revision):
        self.ensure_one()
        self._nasq_check_completion_decision(revision)
        marker = self.env.cr.precommit.data
        previous = set(marker.get(COMPLETION_ACCEPT_IDS) or ())
        authorized = set(previous)
        authorized.add(self.id)
        marker[COMPLETION_ACCEPT_IDS] = authorized
        try:
            self._nasq_clear_completion_request()
            self._nasq_transition(DONE_STATE)
        finally:
            marker[COMPLETION_ACCEPT_IDS] = previous
            if not previous:
                marker.pop(COMPLETION_ACCEPT_IDS, None)
        return self

    def _nasq_return_completion(self, revision, note):
        self.ensure_one()
        if not isinstance(note, str) or not note.strip():
            raise UserError(self.env._("A return note is required."))
        self._nasq_check_completion_decision(revision)
        return self._nasq_clear_completion_request(note=note.strip())

    def _nasq_withdraw_completion(self, revision):
        self.ensure_one()
        self._nasq_check_visible_current()
        self._nasq_lock_completion()
        self.invalidate_recordset()
        if self.project_id:
            self.project_id.invalidate_recordset()
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise UserError(self.env._("A completion revision is required."))
        if not self._nasq_task_is_open_for_completion():
            raise UserError(self.env._("This task is not open for a completion decision."))
        if not self.nasq_completion_pending:
            raise UserError(self.env._("There is no pending completion request."))
        if revision != self.nasq_completion_revision:
            raise UserError(self.env._("This completion request is stale."))
        if self.nasq_completion_requested_by != self.env.user or not self._nasq_can_write():
            raise AccessError(self.env._("Only the requester can withdraw this completion request."))
        return self._nasq_clear_completion_request()

    def unlink(self):
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            raise AccessError(self.env._("Tasks cannot be permanently deleted."))
        return super().unlink()

    def _message_post_after_hook(self, message, msg_values):
        # message_post() (used for comments, e.g. by
        # nasq_pmo/controllers/timeline.py's post_comment) doesn't go through
        # write(), so it wouldn't otherwise emit a `nasq/task` bus
        # notification and a second tab watching the task would never learn
        # a comment was added. Reuse the same partner-targeting logic as
        # write()/create() so a live comment refreshes the activity timeline
        # the same way any other task change does.
        #
        # _message_post_after_hook() is called unconditionally from
        # message_post() (mail_thread.py) for every message it creates, not
        # just manual comments. MailThread.write() defers tracking messages
        # via _track_finalize() -> _message_track(), which itself calls
        # record.message_post(...) whenever a tracked field resolves a
        # subtype (e.g. this module's stage_id/state transitions). Without
        # the guard below, a routine write() that changes such a field would
        # notify twice for the same user action: once from write() above,
        # once here for the tracking message write() triggered internally.
        # Restrict this hook to genuine user comments.
        #
        # message.message_type (not msg_values.get('message_type')) is used
        # here: the created `message` record is authoritative, and
        # mail_thread.py itself doesn't fully trust msg_values to carry the
        # key in every call context (see its own fallback, e.g.
        # `msg_vals.get('message_type') or message.sudo().message_type` in
        # _notify_thread_by_inbox).
        res = super()._message_post_after_hook(message, msg_values)
        if message.message_type == 'comment':
            self._nasq_notify('updated')
        return res
