# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hooks that link the personal task list to the records of other applications.

The tasks application knows no other application. A bridge addon (for
projects and project tasks: liwan_tasks_pmo) inherits this model and fills
the hooks; without one the unified list holds personal tasks only, no row
has a project and nothing can be converted. Every hook runs in the
caller's environment, so ordinary ACLs and record rules still apply.
"""
from odoo import api, models
from odoo.fields import Domain


class LiwanTaskLinks(models.AbstractModel):
    _name = 'liwan.task.links'
    _description = 'Personal task links to other applications'
    _liwan_scope = 'global'

    @api.model
    def _liwan_project_task_domain(self, uid):
        """Domain of the other applications' tasks that join ``uid``'s list (default: none)."""
        return Domain.FALSE

    @api.model
    def _liwan_project_ref(self, task):
        """``{'id', 'name', 'href'}`` of the project of a listed task, or None."""
        return

    @api.model
    def _liwan_can_convert(self, task):
        """Whether the caller may turn the personal ``task`` into a task of another application."""
        return False
