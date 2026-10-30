# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class ProjectTask(models.Model):
    _inherit = 'project.task'

    # A personal task is a task without a project (Odoo's own "Private" value).
    # The record rule and the list domains filter on this column.
    liwan_personal = fields.Boolean(compute='_compute_liwan_personal', store=True, index=True)
    # Odoo 19 forbids ``parent_id`` on a project-less task, so a personal sub-task
    # (a checklist item, depth 1) points at its parent through these own fields.
    # bypass_search_access: the personal-task rules follow this field to the parent's creator and
    # assignees; without it that path would apply the same rules to the parent again, without end.
    # Cost, accepted: an ORM caller can probe a parent through a domain such as
    # ``liwan_parent_id.name`` on the sub-tasks it may read, so the creator and assignees of a
    # sub-task can learn facts about its parent's columns. They are people the parent's
    # participants chose to work with, no route exposes such a domain, and the parent's own
    # record rules still guard reading the parent.
    liwan_parent_id = fields.Many2one('project.task', string='Personal parent task',
                                     index=True, ondelete='cascade', copy=False,
                                     bypass_search_access=True)
    liwan_child_ids = fields.One2many('project.task', 'liwan_parent_id', string='Personal sub-tasks')

    @api.depends('project_id')
    def _compute_liwan_personal(self):
        for task in self:
            task.liwan_personal = not task.project_id

    @api.constrains('liwan_parent_id', 'project_id', 'company_id')
    def _check_liwan_parent(self):
        for task in self.filtered('liwan_parent_id'):
            parent = task.liwan_parent_id
            # A parent loaded earlier in the transaction may have gained a project since (a
            # convert in another request): read the project fresh.
            parent.invalidate_recordset(['project_id'])
            if (
                task.project_id or parent.project_id or parent == task or parent.liwan_parent_id
                or task.liwan_child_ids or parent.company_id != task.company_id
            ):
                raise ValidationError(self.env._(
                    'A personal sub-task needs a personal parent task of its own company, and neither side may have a further level.'))

    def _liwan_participant_partners(self):
        """The partners who may read this personal task: its creator, its assignees and, for a
        sub-task, the creator and assignees of its parent (what the personal-task rules allow).

        A caller who cannot read the parent (a sub-task assignee outside the parent's people) gets the
        task's own people only; the parent's people are never followers of a sub-task by default.
        """
        self.ensure_one()
        people = self.create_uid | self.user_ids
        try:
            parent = self.liwan_parent_id
            people |= parent.create_uid | parent.user_ids
        except AccessError:
            pass
        return people.partner_id

    def _notify_get_recipients(self, message, msg_vals=False, **kwargs):
        """A comment on a personal task reaches the people who can read it, never a removed assignee.

        Odoo makes every assignee a follower and keeps them after they leave the task; the
        personal-task rule removes their read access but ``message_post`` would still mail
        them the comment. Project tasks are untouched.
        """
        recipients = super()._notify_get_recipients(message, msg_vals=msg_vals, **kwargs)
        if not self or not all(self.mapped('liwan_personal')):
            return recipients
        allowed = set()
        for task in self:
            allowed.update(task._liwan_participant_partners().ids)
        return [recipient for recipient in recipients if recipient.get('id') in allowed]
