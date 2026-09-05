# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.project.models.project_task import CLOSED_STATES

MANAGER_STATES = {'03_approved', '02_changes_requested'}
ALL_STATES = {'01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', *CLOSED_STATES}
TASK_CREATE_MARKER = 'nasq_pmo.task_create_depth'
ACCESS_USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'
APPROVAL_WRITE_FIELDS = {'state', 'date_end', 'date_last_stage_update'}
TASK_WRITABLE_FIELDS = {
    'active', 'allocated_hours', 'date_deadline', 'date_end', 'date_last_stage_update',
    'description', 'milestone_id', 'name', 'personal_stage_type_id', 'priority',
    'stage_id', 'state', 'tag_ids', 'user_ids',
}
TASK_CREATE_FIELDS = TASK_WRITABLE_FIELDS | {'parent_id', 'project_id'}


class ProjectTask(models.Model):
    _inherit = 'project.task'

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
        """True when the current user (regardless of ``self``) may approve / request changes."""
        self.ensure_one()
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.tasks.approve', record=self,
        )

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

    @api.model_create_multi
    def create(self, vals_list):
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
        marker = self.env.cr.precommit.data
        marker[TASK_CREATE_MARKER] = marker.get(TASK_CREATE_MARKER, 0) + 1
        try:
            tasks = super().create(vals_list)
        finally:
            marker[TASK_CREATE_MARKER] -= 1
            if not marker[TASK_CREATE_MARKER]:
                marker.pop(TASK_CREATE_MARKER, None)
        tasks._nasq_notify('created')
        return tasks

    def write(self, vals):
        trusted = (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(TASK_CREATE_MARKER)
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
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
        before = {task.id: task.user_ids.partner_id for task in self}
        res = super().write(vals)
        self._nasq_notify('updated', extra_partners=before)
        return res

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
