# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project status, automatic completion and status updates for project.project."""
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from .project_constants import (
    COMPLETION_APPROVAL_VALUES,
    COMPLETION_BACKFILL_PARAM,
    STATUS_VALUES,
)
from odoo.addons.project.models.project_task import CLOSED_STATES


class ProjectProject(models.Model):
    _inherit = 'project.project'

    # Set only by _webvue_sync_completion_status: the project became 'done'
    # because every task closed, and the status it had before, restored when
    # a task reopens. A manual status change clears both.
    webvue_status_auto_done = fields.Boolean(copy=False)
    webvue_status_before_auto_done = fields.Selection(
        [(value, value) for value in sorted(STATUS_VALUES - {'done'})], copy=False,
    )

    # --- archive -------------------------------------------------------------
    def _webvue_archive(self):
        return self._webvue_write_as_manager({'active': False})

    def _webvue_unarchive(self):
        return self._webvue_write_as_manager({'active': True})

    # --- status (phase 2) ----------------------------------------------------
    def _webvue_set_status(self, status):
        if status not in STATUS_VALUES:
            raise ValueError(f"unknown project status {status!r}")
        self._webvue_check_status_allowed(status)
        self._webvue_do_set_status(status)
        self._webvue_post_status_hook(status)
        return self

    def _webvue_check_status_allowed(self, status):
        if not self._webvue_can_manage():
            raise AccessError(self.env._("Only a project manager can set the project status."))

    def _webvue_do_set_status(self, status):
        """The *do* step: no manage-rule check (see _webvue_check_status_allowed)."""
        self._webvue_write_sudo({'last_update_status': status})
        if self.webvue_status_auto_done:
            self.sudo().write({'webvue_status_auto_done': False, 'webvue_status_before_auto_done': False})

    def _webvue_sync_completion_status(self):
        """Mark a project done once every task is closed, and undo that on reopen.

        Complete means at least one done task and no open one (cancelled tasks
        do not block). A project with no tasks never completes. Only an
        automatic completion is reverted; a manager's own 'done' stays.

        sudo(): documented automatic-completion case. It runs after a task
        mutation the caller was already authorized for, reads integer counts
        over all of the project's tasks (the caller may not see every task)
        and writes only the status, its two bookkeeping fields and the status
        update that records the change.
        """
        Task = self.env['project.task'].sudo()
        for project in self.sudo().filtered(lambda p: p.active):
            domain = [('project_id', '=', project.id)]
            open_count = Task.search_count(domain + [('state', 'not in', list(CLOSED_STATES))])
            done_count = Task.search_count(domain + [('state', '=', '1_done')])
            complete = not open_count and done_count > 0
            if complete and project.last_update_status != 'done':
                previous = project.last_update_status
                project.write({
                    'webvue_status_auto_done': True,
                    'webvue_status_before_auto_done': previous if previous in STATUS_VALUES else False,
                })
                project._webvue_record_status('done', self.env._("All tasks are complete"))
            elif not complete and project.webvue_status_auto_done:
                restore = project.webvue_status_before_auto_done or 'on_track'
                project.write({'webvue_status_auto_done': False, 'webvue_status_before_auto_done': False})
                if project.last_update_status == 'done':
                    project._webvue_record_status(restore, self.env._("The project has open tasks again"))

    @api.model
    def _webvue_backfill_completion_status(self):
        """One-time upgrade step: apply automatic completion to existing projects.

        Runs from trusted module data as the superuser. The marker keeps a
        later module update from re-completing a project whose manager has
        since chosen another status by hand. Each project's update title uses
        its company's language, since there is no acting user.
        """
        if not self.env.is_superuser():
            msg = 'completion status backfill requires superuser'
            raise AccessError(msg)
        params = self.env['ir.config_parameter']
        if params.get_param(COMPLETION_BACKFILL_PARAM) == '1':
            return True
        for project in self.search([]):
            lang = project.company_id.partner_id.lang or self.env.lang
            project.with_context(lang=lang)._webvue_sync_completion_status()
        params.set_param(COMPLETION_BACKFILL_PARAM, '1')
        return True

    def _webvue_record_status(self, status, name):
        # Odoo derives last_update_status from the latest project.update, so a
        # status change is recorded as one, named for why it happened.
        self.ensure_one()
        self.env['project.update'].sudo().create({'project_id': self.id, 'status': status, 'name': name})

    def _webvue_post_status_hook(self, status):
        """Extension point; nothing in core."""

    def _webvue_check_completion_policy_vals(self, vals):
        mode = vals.get('webvue_completion_approval')
        if mode is not None and mode not in COMPLETION_APPROVAL_VALUES:
            raise UserError(self.env._("Unknown completion approval mode."))
        for project in self:
            next_mode = vals.get('webvue_completion_approval', project.webvue_completion_approval)
            approver_id = vals.get('webvue_completion_approver_id', project.webvue_completion_approver_id.id)
            if next_mode == 'specific_user':
                user = self.env['res.users'].browse(approver_id).exists() if approver_id else self.env['res.users']
                if not user:
                    raise UserError(self.env._("A specific approver is required."))
                project._webvue_check_approver_eligible(user)
            elif vals.get('webvue_completion_approver_id'):
                raise UserError(self.env._("A specific approver is only valid for specific_user mode."))

    def _webvue_check_approver_eligible(self, user):
        self.ensure_one()
        if not user or user.share or not user.active:
            raise UserError(self.env._("The selected approver must be an active internal user."))
        if self.env.company not in user.company_ids:
            raise UserError(self.env._("The selected approver is outside the current company."))
        if not self.env['webvue.access.service']._webvue_has_capability(
            user, 'pmo.tasks.approve', record=self,
        ):
            raise UserError(self.env._("The selected approver must already have approval capability."))
        try:
            self.with_user(user).with_company(self.env.company)._webvue_check_visible_current()
        except AccessError as error:
            raise UserError(self.env._("The selected approver cannot see this project.")) from error

    def _webvue_invalidate_completion_requests(self):
        tasks = self.env['project.task'].sudo().search([
            ('project_id', 'in', self.ids),
            ('webvue_completion_pending', '=', True),
        ])
        if tasks:
            tasks._webvue_clear_completion_request(invalidate=True)

    def _webvue_completion_reviewer(self):
        self.ensure_one()
        if self.webvue_completion_approval == 'project_manager':
            return self.user_id
        if self.webvue_completion_approval == 'specific_user':
            return self.webvue_completion_approver_id
        return self.env['res.users']

    # --- updates -------------------------------------------------------------
    def _webvue_post_update(self, name, description=''):
        """Create a text project.update that carries the current status unchanged.

        The status is set in project settings (_webvue_set_status) or by
        _webvue_sync_completion_status, never by posting an update.
        """
        self.ensure_one()
        self._webvue_check_manage()
        current = self.last_update_status
        return self.env['project.update'].create({
            'project_id': self.id,
            'status': current if current in STATUS_VALUES else 'on_track',
            'name': name,
            'description': description or False,
        })
