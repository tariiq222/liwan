# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Personal (project-less) task creation while nasq_pmo is installed."""
from odoo import api, models
from odoo.fields import Domain

# The only fields a personal task is created with. Everything else, including
# the project-flavoured state and stage, stays a PMO project-task field.
PERSONAL_CREATE_FIELDS = frozenset({
    'name', 'user_ids', 'date_deadline', 'priority', 'description', 'company_id', 'nasq_parent_id',
})
# Cursor-local marker minted only by the checked convert (nasq.my.task.convert); never a context flag.
CONVERT_MARKER = 'nasq_tasks_pmo.convert_scope'
# The only fields the checked convert writes beyond PMO's whitelist: the project of the task and the
# move of its personal sub-tasks from nasq_parent_id to Odoo's parent_id.
CONVERT_WRITE_FIELDS = frozenset({'project_id', 'nasq_parent_id', 'parent_id'})
# PMO's whitelist already lists every personal field except these. A personal sub-task
# points at its parent through nasq_parent_id: Odoo forbids parent_id without a project.
PERSONAL_EXTRA_FIELDS = frozenset({'company_id', 'nasq_parent_id'})


class ProjectTaskPersonal(models.Model):
    _inherit = 'project.task'

    @api.model
    def _nasq_extra_create_fields(self):
        return super()._nasq_extra_create_fields() | PERSONAL_EXTRA_FIELDS

    @api.model
    def _nasq_projectless_create_allowed(self, vals_list):
        """True only for plain personal-task values from a caller who may create them.

        Nothing raises here; a False answer leaves PMO to refuse the create.
        """
        if (
            not vals_list
            or not self.env['nasq.access.service']._nasq_has_capability(
                self.env.user, 'tasks.tasks.create')
        ):
            return super()._nasq_projectless_create_allowed(vals_list)
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
                return super()._nasq_projectless_create_allowed(vals_list)
            parent_id = vals.get('nasq_parent_id')
            if parent_id and not self.browse(parent_id).exists().nasq_personal:
                return super()._nasq_projectless_create_allowed(vals_list)
        return True

    def _nasq_extra_write_fields(self):
        """Open the project assignment fields for the tasks of the running convert only.

        The marker holds the caller, the company and the ids the convert checked
        (the personal task and its sub-tasks); PMO's visibility and write checks
        still run on those tasks.
        """
        extra = super()._nasq_extra_write_fields()
        scope = self.env.cr.precommit.data.get(CONVERT_MARKER)
        if (
            scope
            and self.ids
            and scope[:2] == (self.env.uid, self.env.company.id)
            and set(self.ids) <= scope[2]
        ):
            extra = extra | CONVERT_WRITE_FIELDS
        return extra

    @api.model
    def _nasq_personal_read_domain(self):
        """A caller with ``tasks.tasks.read`` but no ``pmo.tasks.read`` reaches personal tasks only.

        PMO narrows every search, cold-field fetch and access check of that caller to this
        domain; the personal-task record rules still decide which personal tasks they see.
        """
        if self.env['nasq.access.service']._nasq_has_capability(self.env.user, 'tasks.tasks.read'):
            return Domain('nasq_personal', '=', True)
        return super()._nasq_personal_read_domain()

    def _nasq_can_write(self):
        """A personal task is written under ``tasks.tasks.write``; project tasks keep PMO's rule."""
        self.ensure_one()
        if self.nasq_personal and self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'tasks.tasks.write',
        ):
            return True
        return super()._nasq_can_write()

    def _nasq_emit_comment_notification(self, message):
        """A personal task has no PMO audience: its comments never create a PMO bell row.

        Without this, ``message_post`` on a personal task would reach nasq_pmo's
        ``_message_post_after_hook`` and write an invisible ``comment`` row per assignee that
        would surface in the bell if the task were later converted to a project task.
        """
        if self.nasq_personal:
            return None
        return super()._nasq_emit_comment_notification(message)

    def _nasq_emit_assignment_notifications(self, users):
        """Assigning a personal task sends only nasq_tasks' own ``tasks.assigned`` row, never PMO's."""
        if self.nasq_personal:
            return None
        return super()._nasq_emit_assignment_notifications(users)
