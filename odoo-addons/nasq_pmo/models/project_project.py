# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

from .nasq_settings import CREATORS

# The five statuses a manager may set. Odoo's sixth value, 'to_define', means
# "unset" and is never written by nasq (it is what a project starts as).
STATUS_VALUES = {'on_track', 'at_risk', 'off_track', 'on_hold', 'done'}
# Kept as a distinct exported name: other nasq_pmo modules import
# PROJECT_CREATORS, not nasq_settings.CREATORS, from here.
PROJECT_CREATORS = CREATORS
VISIBILITY_VALUES = ('employees', 'followers')
# Fields a nasq manager (group or per-project assigned user) may write via
# _nasq_write_as_manager/_nasq_write_sudo. Anything else must go through a
# dedicated, explicitly-reviewed path instead of this generic sudo'd write.
MANAGER_WRITABLE = {
    'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date',
    'tag_ids', 'active', 'last_update_status', 'allow_milestones', 'type_ids',
}


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

    def _nasq_create_milestone(self, name, deadline=None):
        self._nasq_check_manage()
        if not self.allow_milestones:
            self._nasq_write_as_manager({'allow_milestones': True})
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
