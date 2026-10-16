# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePmoEntitlementService(models.AbstractModel):
    _inherit = 'webvue.entitlement.service'

    @api.model
    def _webvue_count_usage(self, limit_key):
        if limit_key == 'projects.max_projects':
            return self._webvue_count_projects()
        return super()._webvue_count_usage(limit_key)

    @api.model
    def _webvue_count_projects(self):
        self.env.cr.execute('SELECT count(*) FROM project_project WHERE active')
        return self.env.cr.fetchone()[0]

    @api.model
    def _webvue_claim_projects(self, delta):
        return self._webvue_claim('projects.max_projects', self._webvue_count_projects(), delta)

    @api.model
    def _webvue_terminology_keys(self):
        return super()._webvue_terminology_keys() | frozenset({
            'nav.projects',
            'nav.allProjects',
            'nav.myProjects',
            'nav.projectTasks',
            'nav.tasks',
            'projects.title',
            'tasks.title',
        })
