# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Domain

from odoo.addons.project.models.project_task import CLOSED_STATES

MANAGER_STATES = {'03_approved', '02_changes_requested'}
ALL_STATES = {'01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', *CLOSED_STATES}
DONE_STATE = '1_done'
# Task fields whose change can complete or reopen the project status.
COMPLETION_STATUS_FIELDS = {'state', 'active', 'project_id'}
TASK_CREATE_MARKER = 'webvue_pmo.task_create_depth'
PROJECT_COPY_MARKER = 'webvue_pmo.project_copy_scope'
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
DEPENDENCY_WRITE_MARKER = 'webvue_pmo.dependency_write_depth'
SCHEDULE_WRITE_MARKER = 'webvue_pmo.schedule_write_depth'
COMPLETION_ACCEPT_IDS = 'webvue_pmo.completion_accept_ids'
COMPLETION_META_IDS = 'webvue_pmo.completion_meta_ids'
APPROVAL_WRITE_FIELDS = {'state', 'date_end', 'date_last_stage_update'}
COMPLETION_META_FIELDS = {
    'webvue_completion_pending', 'webvue_completion_revision',
    'webvue_completion_requested_by', 'webvue_completion_requested_at',
    'webvue_completion_return_note',
}
COMPLETION_PRISTINE = {
    'webvue_completion_pending': False,
    'webvue_completion_revision': 0,
    'webvue_completion_requested_by': False,
    'webvue_completion_requested_at': False,
    'webvue_completion_return_note': False,
}
TASK_WRITABLE_FIELDS = {
    'active', 'allocated_hours', 'date_deadline', 'date_end', 'date_last_stage_update',
    'description', 'milestone_id', 'name', 'webvue_deliverables', 'personal_stage_type_id', 'priority',
    'stage_id', 'state', 'tag_ids', 'user_ids',
}
TASK_CREATE_FIELDS = TASK_WRITABLE_FIELDS | {'parent_id', 'project_id'}


def _validate_task_deliverables(value, env=None):
    """Validate and normalize the task's optional output checklist."""
    # `env._()` is called directly: babel only extracts `_` and `_lt`, so a local
    # alias would keep these messages out of every .pot forever.
    if value is None or value is False:
        return []
    if not isinstance(value, list):
        raise ValidationError(env._("Task deliverables must be a list."))
    normalized = []
    for row in value:
        if not isinstance(row, dict) or set(row) != {'name', 'done'}:
            raise ValidationError(env._("Task deliverables must contain exactly name and done."))
        name = row['name']
        if not isinstance(name, str) or not name.strip():
            raise ValidationError(env._("Task deliverable names must not be empty."))
        if not isinstance(row['done'], bool):
            raise ValidationError(env._("Task deliverable done must be a boolean."))
        normalized.append({'name': name.strip(), 'done': row['done']})
    return normalized


class ProjectTask(models.Model):
    _inherit = 'project.task'

    webvue_completion_pending = fields.Boolean(default=False, copy=False, index=True)
    webvue_completion_revision = fields.Integer(default=0, copy=False)
    webvue_completion_requested_by = fields.Many2one('res.users', copy=False, ondelete='set null')
    webvue_completion_requested_at = fields.Datetime(copy=False)
    webvue_completion_return_note = fields.Text(copy=False)
    webvue_planned_start = fields.Date(copy=False, index=True)
    webvue_deliverables = fields.Json(default=lambda self: [], copy=True)

    @api.model
    def _webvue_extra_create_fields(self):
        """Fields a checked internal flow may set on create besides TASK_CREATE_FIELDS.

        None here. An addon that mints tasks from its own records (the
        meetings bridge) adds its origin fields while its cursor-local marker
        is set; a client can never set them.
        """
        return frozenset()

    def _webvue_extra_write_fields(self):
        """Fields a checked internal flow may write besides TASK_WRITABLE_FIELDS.

        None here, so a client write is limited to TASK_WRITABLE_FIELDS. A bridge
        (webvue_tasks_pmo) adds the project assignment fields only while its
        cursor-local marker covers these very tasks; the write is still bound by
        the visibility and ``pmo.tasks.write`` checks of ``write``.
        """
        return frozenset()

    @api.model
    def _webvue_personal_read_domain(self):
        """Extension point: the tasks a caller without ``pmo.tasks.read`` may still read.

        None here, so PMO keeps requiring the capability. A bridge (webvue_tasks_pmo)
        answers a domain that matches personal (project-less) tasks only, after its own
        capability check. Like the copy boundary, it narrows every search, fetch and
        access check; stock ACLs and record rules still run on top.
        """
        return

    @api.model
    def _webvue_projectless_create_allowed(self, vals_list):
        """Extension point: may these values create tasks that have no project?

        False here, so every non-admin create needs a visible project. A bridge
        addon (webvue_tasks_pmo) answers True only for its own project-less
        tasks after its own capability check; the field whitelist and the
        stock ORM ACLs and record rules still apply to the values.
        """
        return False

    @api.model
    def _webvue_copy_population_domain(self):
        """Return only the fresh project's boundary, never a capability grant.

        Only a checked project copy mints this cursor-local scope. No
        client context flag is consulted; another uid/company cannot reuse it.
        """
        scope = self.env.cr.precommit.data.get(PROJECT_COPY_MARKER)
        if not scope or scope[:2] != (self.env.uid, self.env.company.id):
            return None
        project = self.env['project.project'].browse(scope[2]).exists()
        project._webvue_check_visible_current()
        if not project or project.user_id != self.env.user or not project._webvue_can_create():
            return None
        return Domain('project_id', '=', project.id) & Domain('company_id', '=', self.env.company.id)

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
            service = self.env['webvue.access.service']
            if not service._webvue_has_capability(self.env.user, 'pmo.tasks.read'):
                boundary = self._webvue_copy_population_domain()
                if boundary is None:
                    boundary = self._webvue_personal_read_domain()
                if boundary is None:
                    service._webvue_require_capability('pmo.tasks.read')
                else:
                    # Constrain every search/fetch/count, including an empty or
                    # hostile OR domain. Stock ACLs and record rules still run.
                    domain = Domain(domain) & boundary
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def _check_access(self, operation):
        # Stock ir.attachment checks its comodel through _filtered_access.
        # Enforce the same capability in all raising/non-raising ORM helpers.
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            service = self.env['webvue.access.service']
            if not service._webvue_has_capability(self.env.user, 'pmo.tasks.read'):
                try:
                    boundary = self._webvue_copy_population_domain()
                    scope = 'copy'
                    if boundary is None:
                        boundary = self._webvue_personal_read_domain()
                        scope = 'personal'
                    if boundary is None:
                        return self, lambda: AccessError('forbidden')
                    if self:
                        # The inherited search enforces both stock rules and
                        # the copy scope without reading unverified fields.
                        # Return the denied subset so mixed recordsets retain
                        # only genuinely readable tasks in _filtered_access.
                        query = super()._search(
                            Domain('id', 'in', self.ids) & boundary, active_test=False,
                        )
                        forbidden = self - self.browse(query)
                        if forbidden:
                            return forbidden, lambda: AccessError(
                                self.env._(
                                    "Only tasks in the new project may be read during a project copy.",
                                )
                                if scope == 'copy' else 'forbidden',
                            )
                except AccessError as error:
                    # Scope validation and stock search may raise; this hook
                    # must instead let its caller choose raising or filtering.
                    return self, lambda error=error: error
        return super()._check_access(operation)

    def _webvue_check_visible_current(self):
        if not self:
            return self
        if any(
            task.company_id and task.company_id != self.env.company
            for task in self
        ):
            raise AccessError(self.env._("Task is outside the current company."))
        self.check_access('read')
        return self

    def _webvue_can_write(self):
        self.ensure_one()
        return self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'pmo.tasks.write', record=self,
        )

    def _webvue_can_archive(self):
        self.ensure_one()
        return self._webvue_can_write() and (
            self.create_uid == self.env.user or self._webvue_can_approve()
        )

    def _webvue_archive(self):
        self.ensure_one()
        if not self._webvue_can_archive():
            raise AccessError(self.env._("Only the project manager or the task's creator can archive it."))
        self.write({'active': False})
        return self

    def _webvue_notify(self, event, extra_partners=None):
        # A single user action can re-enter write() (e.g. project.task's own
        # write() override does a plain `task.date_last_stage_update = now`
        # assignment when 'state' changes, which for a stored field triggers
        # a second, independent records.write() call that recurses through
        # the whole write() stack, including this override) and end up
        # calling _webvue_notify() more than once for what is really one
        # user action. Rather than emit immediately, accumulate
        # (partner_id, task_id, event) triples on the cursor's precommit
        # data and drain them once, right before commit, deduplicated by
        # set membership — the same idiom bus.bus._sendone()/_ensure_hooks()
        # itself uses (see addons/bus/models/bus.py) to batch its own
        # notifications until precommit time.
        precommit = self.env.cr.precommit
        key = 'webvue_pmo.task_notifications'
        if key not in precommit.data:
            precommit.data[key] = set()

            @precommit.add
            def _flush_webvue_notifications():
                pending = precommit.data.pop(key, ())
                if not pending:
                    return
                bus = self.env['bus.bus']
                for partner_id, task_id, evt in pending:
                    bus._sendone(
                        self.env['res.partner'].browse(partner_id),
                        'webvue/task',
                        {'id': task_id, 'event': evt},
                    )

        pending = precommit.data[key]
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                pending.add((partner.id, task.id, event))

    def _webvue_vals_with_defaults(self, vals):
        merged = dict(vals)
        ctx = self.env.context
        if 'state' not in merged and ctx.get('default_state'):
            merged['state'] = ctx['default_state']
        if 'project_id' not in merged and ctx.get('default_project_id'):
            merged['project_id'] = ctx['default_project_id']
        if 'parent_id' not in merged and ctx.get('default_parent_id'):
            merged['parent_id'] = ctx['default_parent_id']
        return merged

    def _webvue_accept_ids(self):
        return set(self.env.cr.precommit.data.get(COMPLETION_ACCEPT_IDS) or ())

    def _webvue_reject_unauthorized_done(self, tasks):
        accept_ids = self._webvue_accept_ids()
        illegal = tasks.filtered(
            lambda task: task.state == DONE_STATE
            and task._webvue_completion_required()
            and task.id not in accept_ids,
        )
        if illegal:
            raise AccessError(self.env._("This task requires completion approval."))

    @api.model
    def _webvue_create_for_copy(self, project, values):
        """Create one copied task under the server-owned fresh-project scope.

        This private helper never elevates ORM ACLs and cannot grant the scope.
        The project copy owns its lifetime and removes it in finally.
        """
        project.ensure_one()
        scope = (self.env.uid, self.env.company.id, project.id)
        if self.env.cr.precommit.data.get(PROJECT_COPY_MARKER) != scope:
            raise AccessError(self.env._("Project copy scope is required."))
        project._webvue_check_visible_current()
        if project.user_id != self.env.user or not project._webvue_can_create():
            raise AccessError(self.env._("You are not allowed to copy this project."))
        if values.get('project_id') != project.id:
            raise AccessError(self.env._("Copied task must belong to the new project."))
        task = self.create(values)
        # Stock project.task explicitly subscribes its creator even with mail
        # tracking disabled. Copied tasks must create no followers. Removing
        # the caller's own automatic subscription uses ordinary mail ACLs.
        task.message_unsubscribe(partner_ids=[self.env.user.partner_id.id])
        return task

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._webvue_vals_with_defaults(vals) for vals in vals_list]
        trusted = (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        )
        if not trusted:
            service = self.env['webvue.access.service']
            for vals in vals_list:
                allowed = TASK_CREATE_FIELDS | self._webvue_extra_create_fields()
                if set(vals) - allowed:
                    raise AccessError(self.env._("Task fields are not allowed."))
                parent = self.browse(vals.get('parent_id')).exists()
                if parent:
                    parent._webvue_check_visible_current()
                project = self.env['project.project'].browse(
                    vals.get('project_id'),
                ).exists()
                if not project and parent:
                    project = parent.project_id
                if not project:
                    if self._webvue_projectless_create_allowed(vals_list):
                        continue
                    raise AccessError(self.env._("A visible current-company project is required."))
                project._webvue_check_visible_current()
                if parent and parent.project_id != project:
                    raise AccessError(self.env._("Parent task must belong to the same project."))
                # Minted only inside a checked copy into a freshly created
                # project; never trust an RPC/context flag. All other
                # field, visibility, approval and stock ORM checks still run.
                scope = (self.env.uid, self.env.company.id, project.id)
                if self.env.cr.precommit.data.get(PROJECT_COPY_MARKER) != scope:
                    service._webvue_require_capability('pmo.tasks.create', record=project)
                if vals.get('state') in MANAGER_STATES:
                    service._webvue_require_capability('pmo.tasks.approve', record=project)
                if vals.get('state') == DONE_STATE and project.webvue_completion_approval != 'none':
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
        if not self.env.is_superuser() and tasks.filtered('webvue_planned_start'):
            raise AccessError(self.env._(
                "Task scheduling must use the dedicated schedule operation.",
            ))
        self._webvue_reject_unauthorized_done(tasks)
        tasks._webvue_validate_schedule_invariant()
        dirty = tasks.filtered(
            lambda task: (
                task.webvue_completion_pending
                or task.webvue_completion_revision
                or task.webvue_completion_requested_by
                or task.webvue_completion_requested_at
                or task.webvue_completion_return_note
            ),
        )
        if dirty:
            raise AccessError(self.env._("Completion metadata cannot be set on create."))
        tasks._webvue_notify('created')
        tasks.project_id._webvue_sync_completion_status()
        return tasks

    @api.constrains('milestone_id', 'project_id', 'webvue_planned_start', 'date_deadline')
    def _check_webvue_milestone_bounds(self):
        # A task assignee may be allowed to edit a task in a followers-only
        # project while the milestone itself is hidden by project rules. This
        # internal scalar validation must not turn that legitimate write into
        # an access error or expose the milestone's private content.
        for task in self.sudo():
            milestone = task.milestone_id
            if not milestone:
                continue
            if milestone.project_id != task.project_id:
                raise ValidationError(self.env._("Milestone must belong to the task's project."))
            milestone._webvue_validate_task_bounds(task)
        return True

    @api.constrains('webvue_deliverables')
    def _check_webvue_deliverables(self):
        for task in self:
            _validate_task_deliverables(task.webvue_deliverables, self.env)
        return True

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
            and set(vals) <= {'webvue_planned_start', 'date_deadline'},
        )
        accept_ids = self._webvue_accept_ids()
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
            self._webvue_check_visible_current()
            if set(vals) - (TASK_WRITABLE_FIELDS | self._webvue_extra_write_fields()):
                raise AccessError(self.env._("Task fields are not allowed."))
            if 'active' in vals and any(not task._webvue_can_archive() for task in self):
                raise AccessError(self.env._(
                    "Only the project manager or the task's creator can archive it.",
                ))
            approval_write = vals.get('state') in MANAGER_STATES
            if approval_write and any(not task._webvue_can_approve() for task in self):
                raise AccessError(self.env._("Only a project manager can approve or request changes."))
            if (not approval_write or set(vals) - APPROVAL_WRITE_FIELDS) and any(
                not task._webvue_can_write() for task in self
            ):
                raise AccessError(self.env._("You are not allowed to change this task."))
        if not schedule_write:
            if 'webvue_planned_start' in vals:
                raise AccessError(self.env._("Task scheduling must use the dedicated schedule operation."))
            if 'date_deadline' in vals:
                deadline = fields.Date.to_date(vals['date_deadline']) if vals['date_deadline'] else False
                if any(
                    task.webvue_planned_start and (
                        not deadline or task.webvue_planned_start > deadline
                    )
                    for task in self
                ):
                    raise ValidationError(self.env._("Schedule start must be on or before the end date."))
        if vals.get('state') == DONE_STATE:
            unauthorized = self.filtered(
                lambda task: task._webvue_completion_required() and task.id not in accept_ids,
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
        if clears_request and self.filtered('webvue_completion_pending'):
            self._webvue_lock_projects_then_tasks(self.mapped('project_id'), self)
            self.invalidate_recordset()
            self.mapped('project_id').invalidate_recordset()
        before = {task.id: task.user_ids.partner_id for task in self}
        status_projects = self.project_id if COMPLETION_STATUS_FIELDS & set(vals) else None
        res = super().write(vals)
        if vals.get('state') == DONE_STATE:
            self._webvue_reject_unauthorized_done(self)
        if not completion_meta_write:
            if vals.get('state') or vals.get('active') is False:
                pending = self.filtered('webvue_completion_pending')
                if pending:
                    pending._webvue_clear_completion_request(invalidate=True)
            if 'user_ids' in vals:
                for task in self.filtered('webvue_completion_pending'):
                    requester = task.webvue_completion_requested_by
                    if requester and requester not in task.user_ids:
                        task._webvue_clear_completion_request(invalidate=True)
        self._webvue_notify('updated', extra_partners=before)
        if status_projects is not None:
            (status_projects | self.project_id)._webvue_sync_completion_status()
        return res

    def unlink(self):
        if (
            not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
        ):
            raise AccessError(self.env._("Tasks cannot be permanently deleted."))
        projects = self.project_id
        res = super().unlink()
        projects._webvue_sync_completion_status()
        return res

    def _message_post_after_hook(self, message, msg_values):
        # message_post() (used for comments, e.g. by
        # webvue_pmo/controllers/timeline.py's post_comment) doesn't go through
        # write(), so it wouldn't otherwise emit a `webvue/task` bus
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
            self._webvue_notify('updated')
        return res
