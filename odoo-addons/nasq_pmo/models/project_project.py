# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}
PROJECT_CREATORS = ('managers', 'employees')
VISIBILITY_VALUES = ('employees', 'followers')


def _not_empty(message, count):
    err = UserError(message)
    err.nasq_count = count
    return err


class ProjectProject(models.Model):
    _inherit = 'project.project'

    # --- rules ---------------------------------------------------------------
    def _nasq_is_admin(self):
        return self.env.user.has_group('nasq_core.group_customer_admin')

    def _nasq_is_manager(self):
        """Group-level rule: project managers and customer admins (any project)."""
        return self.env.user.has_group('project.group_project_manager') or self._nasq_is_admin()

    def _nasq_can_manage(self):
        """Per-project rule: the group rule OR being this project's assigned manager."""
        self.ensure_one()
        return self._nasq_is_manager() or self.user_id == self.env.user

    def _nasq_check_manage(self):
        if not self._nasq_can_manage():
            raise AccessError(self.env._("Only the project manager can change this project."))

    def _nasq_can_create(self):
        return self._nasq_is_manager() or self.env['nasq.pmo.settings'].get()['project_creators'] == 'employees'

    # --- create --------------------------------------------------------------
    def _nasq_create_from_policy(self, name):
        """Create a project the nasq way: policy check, defaults, default stages.

        When the company policy lets every employee create projects, the create
        itself runs in sudo (Odoo's ACL reserves project creation to managers);
        the policy is the explicit, admin-set widening of that ACL, and
        ``create_uid``/``user_id`` still record the employee. Second documented
        ``sudo()`` in nasq_pmo.
        """
        if not self._nasq_can_create():
            raise AccessError(self.env._("You are not allowed to create projects."))
        vals = self._nasq_create_vals(name)
        env = self.env if self._nasq_is_manager() else self.sudo().env
        project = env['project.project'].create(vals)
        return self.browse(project.id)

    def _nasq_create_vals(self, name):
        stages = self.env['nasq.pmo.settings']._default_stage_vals()
        return {
            'name': name,
            'user_id': self.env.uid,
            'privacy_visibility': 'employees',
            'allow_milestones': True,
            'type_ids': [(0, 0, s) for s in stages],
        }

    # --- archive -------------------------------------------------------------
    def _nasq_archive(self):
        """Archive ``self``; ``_nasq_check_manage`` is the real gate.

        Odoo's ACL only lets ``project.group_project_manager`` write
        ``project.project``, but nasq's per-project rule also lets the project's
        assigned (non-manager) user manage it, so the write itself runs in sudo
        once that check passes. Third documented ``sudo()`` in nasq_pmo.
        """
        self._nasq_check_manage()
        self.sudo().write({'active': False})
        return self

    def _nasq_unarchive(self):
        self._nasq_check_manage()
        self.sudo().write({'active': True})
        return self

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
        self.write({'last_update_status': status})

    def _nasq_post_status_hook(self, status):
        """Extension point; nothing in core."""

    # --- updates -------------------------------------------------------------
    def _nasq_post_update(self, status, name, description=''):
        """Create a project.update (Odoo recomputes last_update_status from it)."""
        self.ensure_one()
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._nasq_check_status_allowed(status)
        return self.env['project.update'].create({
            'project_id': self.id,
            'status': status,
            'name': name,
            'description': description or False,
        })

    # --- stages --------------------------------------------------------------
    def _nasq_stage_task_count(self, stage):
        return self.env['project.task'].with_context(active_test=False).search_count(
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
            self.write({'type_ids': [(3, stage.id)]})
        else:
            stage.unlink()

    # --- followers -----------------------------------------------------------
    def _nasq_followers(self):
        partners = self.message_partner_ids
        return partners.mapped('user_ids').filtered(lambda u: not u.share and u.active)

    def _nasq_add_follower(self, user):
        self._nasq_check_manage()
        self.message_subscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    def _nasq_remove_follower(self, user):
        self._nasq_check_manage()
        self.message_unsubscribe(partner_ids=[user.partner_id.id])
        return self._nasq_followers()

    # --- milestones ----------------------------------------------------------
    def _nasq_milestone_task_counts(self, milestone):
        Task = self.env['project.task']
        domain = [('project_id', '=', self.id), ('milestone_id', '=', milestone.id)]
        return Task.search_count(domain), Task.search_count(domain + [('state', 'in', ('1_done', '1_canceled'))])

    def _nasq_create_milestone(self, name, deadline=None):
        self._nasq_check_manage()
        if not self.allow_milestones:
            self.write({'allow_milestones': True})
        return self.env['project.milestone'].create({
            'project_id': self.id, 'name': name, 'deadline': fields.Date.to_date(deadline) if deadline else False,
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
