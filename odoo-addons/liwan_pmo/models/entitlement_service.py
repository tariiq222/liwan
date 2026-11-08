# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PROJECTS_LIMIT = 'projects.max_projects'


class LiwanPmoEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_count_usage(self, limit_key):
        if limit_key == PROJECTS_LIMIT:
            return self._liwan_count_projects()
        return super()._liwan_count_usage(limit_key)

    @api.model
    def _liwan_count_projects(self):
        self.env.cr.execute('SELECT count(*) FROM project_project WHERE active')
        return self.env.cr.fetchone()[0]

    @api.model
    def _liwan_claim_projects(self, delta):
        """Claim DELTA project slots, counting the active projects under the tenant fence.

        ``_liwan_claim`` locks the tenant profile row before it checks the limit, but it takes the
        usage from its caller, so counting first let a create read the count before the fence was
        held and two concurrent creates could both fit the last slot. A create therefore locks that
        row here and only then counts; the lock ``_liwan_claim`` takes again on the same row in the
        same transaction is a no-op. An archive (a negative delta) only frees a slot and is never
        refused: ``_liwan_claim`` returns before it looks at the usage, so it is given none.

        The count under the fence is not the whole guarantee, because Odoo runs REPEATABLE READ: a
        transaction whose snapshot predates a concurrent commit still cannot see that commit's
        project. Such a loser then locks the profile row the winner updated
        (``_liwan_bump_quota_revision``), and PostgreSQL refuses that lock with a serialization
        failure instead of letting a stale count pass. Odoo retries the request, which counts again
        from a fresh snapshot and refuses the create.
        """
        current = 0
        if delta > 0:
            self._liwan_profile()._liwan_lock()
            current = self._liwan_count_projects()
        return self._liwan_claim(PROJECTS_LIMIT, current, delta)

    @api.model
    def _liwan_terminology_keys(self):
        return super()._liwan_terminology_keys() | frozenset({
            'nav.projects',
            'nav.allProjects',
            'nav.myProjects',
            'nav.projectTasks',
            'nav.tasks',
            'projects.title',
            'tasks.title',
        })
