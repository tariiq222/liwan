# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Personal (project-less) task creation while webvue_pmo is installed."""
from odoo import api, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Domain

# The only fields a personal task is created with. Everything else, including
# the project-flavoured state and stage, stays a PMO project-task field.
PERSONAL_CREATE_FIELDS = frozenset({
    'name', 'user_ids', 'date_deadline', 'priority', 'description', 'company_id', 'webvue_parent_id',
})
# Cursor-local marker minted only by the checked convert (webvue.my.task.convert); never a context flag.
CONVERT_MARKER = 'webvue_tasks_pmo.convert_scope'
# The only fields the checked convert writes beyond PMO's whitelist: the project of the task and the
# move of its personal sub-tasks from webvue_parent_id to Odoo's parent_id.
CONVERT_WRITE_FIELDS = frozenset({'project_id', 'webvue_parent_id', 'parent_id'})
# What a write of a personal task may carry, whoever sends it (the /my-tasks service or one of
# PMO's own routes): the personal fields, the three states of a personal task and the date
# bookkeeping Odoo keeps next to a state change. Stages, tags, milestones, hours, deliverables,
# archiving and every project-flavoured state stay out, so a PMO route cannot put a personal
# task in a shape /my-tasks cannot show or restore.
PERSONAL_WRITE_FIELDS = frozenset({
    'name', 'description', 'date_deadline', 'priority', 'user_ids',
    'state', 'date_end', 'date_last_stage_update', 'date_assign',
})
PERSONAL_STATES = frozenset({'01_in_progress', '1_done', '1_canceled'})
# The personal contract knows normal and high only; PMO's other priorities would show as normal
# in /my-tasks and be reset by its next write.
PERSONAL_PRIORITIES = frozenset({'0', '1'})
# PMO's whitelist already lists every personal field except these. A personal sub-task
# points at its parent through webvue_parent_id: Odoo forbids parent_id without a project.
PERSONAL_EXTRA_FIELDS = frozenset({'company_id', 'webvue_parent_id'})


class ProjectTaskPersonal(models.Model):
    _inherit = 'project.task'

    @api.model
    def _webvue_extra_create_fields(self):
        return super()._webvue_extra_create_fields() | PERSONAL_EXTRA_FIELDS

    @api.model
    def _webvue_projectless_create_allowed(self, vals_list):
        """True only for plain personal-task values from a caller who may create them.

        Nothing raises here; a False answer leaves PMO to refuse the create.
        """
        if (
            not vals_list
            or not self.env['webvue.access.service']._webvue_has_capability(
                self.env.user, 'tasks.tasks.create')
        ):
            return super()._webvue_projectless_create_allowed(vals_list)
        company = self.env.company
        for vals in vals_list:
            if (
                vals.get('project_id')
                or set(vals) - PERSONAL_CREATE_FIELDS
                # Required, not defaulted: stock create fills a missing company_id from the
                # context (default_company_id) after PMO's checks, which would pick a company
                # where the caller holds no capability.
                or vals.get('company_id') != company.id
            ):
                return super()._webvue_projectless_create_allowed(vals_list)
            parent_id = vals.get('webvue_parent_id')
            if parent_id:
                try:
                    is_personal = self.browse(parent_id).exists().webvue_personal
                except AccessError:
                    # A parent the caller cannot read is not an answer to raise: PMO refuses the create.
                    is_personal = False
                if not is_personal:
                    return super()._webvue_projectless_create_allowed(vals_list)
        return True

    def _webvue_in_convert_scope(self):
        """True while the checked convert runs for exactly these tasks (same caller and company)."""
        scope = self.env.cr.precommit.data.get(CONVERT_MARKER)
        return bool(
            scope
            and self.ids
            and scope[:2] == (self.env.uid, self.env.company.id)
            and set(self.ids) <= scope[2],
        )

    def _webvue_extra_write_fields(self):
        """Open the project assignment fields for the tasks of the running convert only.

        The marker holds the caller, the company and the ids the convert checked
        (the personal task and its sub-tasks); PMO's visibility and write checks
        still run on those tasks.
        """
        extra = super()._webvue_extra_write_fields()
        if self._webvue_in_convert_scope():
            extra = extra | CONVERT_WRITE_FIELDS
        return extra

    def write(self, vals):
        """Hold every write of a personal task to the values /my-tasks itself writes.

        PMO's routes reach personal tasks too (``_webvue_can_write`` below answers for them), so
        the values are the guard: the service only writes allowed ones, and anything else is
        refused here before PMO's own checks. Internal (``sudo``) writes and the checked
        convert are not held to it.
        """
        personal = self.filtered('webvue_personal') if not self.env.su else self.browse()
        if personal and not personal._webvue_in_convert_scope():
            if set(vals) - PERSONAL_WRITE_FIELDS:
                raise AccessError(self.env._('A personal task only takes its own fields.'))
            if 'state' in vals and vals['state'] not in PERSONAL_STATES:
                raise AccessError(self.env._('A personal task is open, done or cancelled.'))
            if 'priority' in vals and vals['priority'] not in PERSONAL_PRIORITIES:
                raise AccessError(self.env._('A personal task has a normal or a high priority.'))
        result = super().write(vals)
        if personal and 'user_ids' in vals and not personal._webvue_in_convert_scope():
            for task in personal:
                ids = task.user_ids.ids
                if len(self.env['webvue.directory']._webvue_people(ids)) != len(ids):
                    raise ValidationError(self.env._('Assignees must be active people of this company.'))
        return result

    @api.model
    def _webvue_personal_read_domain(self):
        """A caller with ``tasks.tasks.read`` but no ``pmo.tasks.read`` reaches personal tasks only.

        PMO narrows every search, cold-field fetch and access check of that caller to this
        domain; the personal-task record rules still decide which personal tasks they see.
        """
        if self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'tasks.tasks.read'):
            return Domain('webvue_personal', '=', True)
        return super()._webvue_personal_read_domain()

    def _webvue_can_write(self):
        """A personal task is written under ``tasks.tasks.write``; project tasks keep PMO's rule."""
        self.ensure_one()
        if self.webvue_personal and self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'tasks.tasks.write',
        ):
            return True
        return super()._webvue_can_write()

    def _webvue_can_archive(self):
        """A personal task is never archived: no route of /my-tasks could restore it."""
        self.ensure_one()
        if self.webvue_personal:
            return False
        return super()._webvue_can_archive()

    def _webvue_emit_comment_notification(self, message):
        """A personal task has no PMO audience: its comments never create a PMO bell row.

        Without this, ``message_post`` on a personal task would reach webvue_pmo's
        ``_message_post_after_hook`` and write an invisible ``comment`` row per assignee that
        would surface in the bell if the task were later converted to a project task.
        """
        if self.webvue_personal:
            return None
        return super()._webvue_emit_comment_notification(message)

    def _webvue_emit_assignment_notifications(self, users):
        """Assigning a personal task sends only webvue_tasks' own ``tasks.assigned`` row, never PMO's."""
        if self.webvue_personal:
            return None
        return super()._webvue_emit_assignment_notifications(users)
