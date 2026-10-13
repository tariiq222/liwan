# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Personal (project-less) task creation while nasq_pmo is installed."""
from odoo import api, models

# The only fields a personal task is created with. Everything else, including
# the project-flavoured state and stage, stays a PMO project-task field.
PERSONAL_CREATE_FIELDS = frozenset({
    'name', 'user_ids', 'date_deadline', 'priority', 'description', 'company_id', 'nasq_parent_id',
})
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
