# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project stages, followers and milestones for project.project."""
from odoo import fields, models

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

    def _webvue_add_stage(self, name, fold=False):
        self._webvue_check_manage()
        last = max(self.type_ids.mapped('sequence'), default=0)
        return self.env['project.task.type'].create({
            'name': name, 'fold': fold, 'sequence': last + 10, 'project_ids': [(4, self.id)],
        })

    def _webvue_update_stage(self, stage, vals):
        self._webvue_check_manage()
        if stage not in self.type_ids:
            msg = "stage does not belong to this project"
            raise ValueError(msg)
        stage.write({k: v for k, v in vals.items() if k in ('name', 'fold')})
        return stage

    def _webvue_reorder_stages(self, ids):
        self._webvue_check_manage()
        if sorted(ids) != sorted(self.type_ids.ids):
            msg = "ids must be a permutation of the project's stage ids"
            raise ValueError(msg)
        for i, stage_id in enumerate(ids):
            self.env['project.task.type'].browse(stage_id).write({'sequence': (i + 1) * 10})
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
            stage.unlink()

    # --- followers -----------------------------------------------------------
    def _webvue_followers(self):
        partners = self.message_partner_ids
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
