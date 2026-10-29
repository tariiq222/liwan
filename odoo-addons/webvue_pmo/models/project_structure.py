# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project stages, followers and milestones for project.project."""
from odoo import fields, models
from odoo.exceptions import AccessError

from .project_charter import WebVueCharterState
from .project_constants import _not_empty


class ProjectProject(models.Model):
    _inherit = 'project.project'

    # --- stages --------------------------------------------------------------
    def _webvue_stage_task_count(self, stage):
        # sudo(): only an integer count is returned (never task records), so this
        # cannot leak data; without it, ir.rule on a followers-only project would
        # under-count hidden tasks and let a stage with tasks the caller can't see
        # be deleted out from under them.
        return self.env['project.task'].sudo().with_context(active_test=False).search_count(
            [('project_id', '=', self.id), ('stage_id', '=', stage.id)])

    def _webvue_stages_sudo(self):
        # sudo(): documented manager-write case for project stages. Odoo's
        # project.task.type rule lets a project user write only personal stages;
        # the project's shared stages need project.group_project_manager, which a
        # WebVue role or the project's own manager does not hold. Every caller has
        # passed _webvue_check_manage first.
        return self.env['project.task.type'].sudo()

    def _webvue_writable_stages(self, stages):
        """The elevated stages, once the caller may change them for every project they belong to.

        A stage linked to several projects changes in all of them, so it may be renamed, folded
        or reordered only when every linked project is in this project's company and the caller
        manages any project there (the group rule, checked in that company).
        """
        elevated = self._webvue_stages_sudo().browse(stages.ids)
        shared = elevated.filtered(lambda stage: len(stage.project_ids) > 1)
        if shared and (
            shared.project_ids.company_id != self.company_id
            or not self.with_company(self.company_id)._webvue_is_manager()
        ):
            raise AccessError(self.env._("This stage is shared with other projects; only a PMO manager of every project using it can change it."))
        return elevated

    def _webvue_add_stage(self, name, fold=False):
        self._webvue_check_manage()
        last = max(self.type_ids.mapped('sequence'), default=0)
        stage = self._webvue_stages_sudo().create({
            'name': name, 'fold': fold, 'sequence': last + 10, 'project_ids': [(4, self.id)],
        })
        return self.env['project.task.type'].browse(stage.id)

    def _webvue_update_stage(self, stage, vals):
        self._webvue_check_manage()
        if stage not in self.type_ids:
            msg = "stage does not belong to this project"
            raise ValueError(msg)
        self._webvue_writable_stages(stage).write({k: v for k, v in vals.items() if k in ('name', 'fold')})
        return stage

    def _webvue_reorder_stages(self, ids):
        self._webvue_check_manage()
        if sorted(ids) != sorted(self.type_ids.ids):
            msg = "ids must be a permutation of the project's stage ids"
            raise ValueError(msg)
        writable = self._webvue_writable_stages(self.type_ids)
        for i, stage_id in enumerate(ids):
            writable.browse(stage_id).write({'sequence': (i + 1) * 10})
        return self.type_ids.sorted(lambda s: (s.sequence, s.id))

    def _webvue_delete_stage(self, stage):
        self._webvue_check_manage()
        if stage not in self.type_ids:
            msg = "stage does not belong to this project"
            raise ValueError(msg)
        count = self._webvue_stage_task_count(stage)
        if count:
            raise _not_empty(self.env._("This stage still holds tasks."), count)
        if len(stage.project_ids) > 1:
            # Shared stage: detach from this project only.
            self._webvue_write_as_manager({'type_ids': [(3, stage.id)]})
        else:
            self._webvue_stages_sudo().browse(stage.id).unlink()

    # --- followers -----------------------------------------------------------
    def _webvue_followers(self):
        # Read the follower rows, not the computed message_partner_ids: on a
        # followers-only project, computing that field as the caller runs the
        # read rule, whose in-memory check reads the same field while it is
        # being computed and refuses the follower who asked.
        partners = self.message_follower_ids.partner_id
        return partners.mapped('user_ids').filtered(lambda u: not u.share and u.active)

    def _webvue_add_follower(self, user):
        self._webvue_check_manage()
        # sudo(): mail.thread.message_subscribe checks 'write' on the project
        # itself, which Odoo's ACL grants only to the project-manager group —
        # same rationale as _webvue_write_as_manager, for the assigned-user-as-
        # manager case Odoo's own ACL doesn't know about.
        self.sudo().message_subscribe(partner_ids=[user.partner_id.id])
        return self._webvue_followers()

    def _webvue_remove_follower(self, user):
        self._webvue_check_manage()
        if (
            self.webvue_charter_state == 'submitted' and self.privacy_visibility == 'followers'
            and user == self.webvue_sponsor_id
        ):
            raise WebVueCharterState(self.env._("The sponsor is reviewing the charter; withdraw it before removing the sponsor."))
        # sudo(): same rationale as _webvue_add_follower above.
        self.sudo().message_unsubscribe(partner_ids=[user.partner_id.id])
        return self._webvue_followers()

    # --- milestones ----------------------------------------------------------
    def _webvue_milestone_task_counts(self, milestone):
        # sudo(): only integer counts are returned (never task records); see
        # _webvue_stage_task_count for why an unsudo'd count would under-count on
        # followers-only projects and let a non-empty milestone be deleted.
        Task = self.env['project.task'].sudo()
        domain = [('project_id', '=', self.id), ('milestone_id', '=', milestone.id)]
        return Task.search_count(domain), Task.search_count(domain + [('state', 'in', ('1_done', '1_canceled'))])

    def _webvue_create_milestone(self, name, deadline=None, start_date=None, deliverables=None):
        self._webvue_check_manage()
        if not self.allow_milestones:
            self._webvue_write_as_manager({'allow_milestones': True})
        return self.env['project.milestone'].create({
            'project_id': self.id, 'name': name,
            'deadline': fields.Date.to_date(deadline) if deadline else False,
            'webvue_start_date': fields.Date.to_date(start_date) if start_date else False,
            'webvue_deliverables': deliverables or [],
        })

    def _webvue_update_milestone(self, milestone, vals):
        self._webvue_check_manage()
        if milestone.project_id != self:
            msg = "milestone does not belong to this project"
            raise ValueError(msg)
        clean = {}
        if 'name' in vals:
            clean['name'] = vals['name']
        if 'deadline' in vals:
            clean['deadline'] = fields.Date.to_date(vals['deadline']) if vals['deadline'] else False
        if 'start_date' in vals:
            clean['webvue_start_date'] = fields.Date.to_date(vals['start_date']) if vals['start_date'] else False
        if 'deliverables' in vals:
            clean['webvue_deliverables'] = vals['deliverables']
        if 'is_reached' in vals:
            clean['is_reached'] = bool(vals['is_reached'])
        milestone.write(clean)
        return milestone

    def _webvue_delete_milestone(self, milestone):
        self._webvue_check_manage()
        if milestone.project_id != self:
            msg = "milestone does not belong to this project"
            raise ValueError(msg)
        total, _done = self._webvue_milestone_task_counts(milestone)
        if total:
            raise _not_empty(self.env._("Tasks are still linked to this milestone."), total)
        milestone.unlink()
