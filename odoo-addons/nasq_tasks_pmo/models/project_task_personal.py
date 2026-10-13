# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Personal (project-less) task creation while nasq_pmo is installed."""
from odoo import api, models
from odoo.fields import Domain
from odoo.orm.domains import DomainAnd, DomainCondition

# The only fields a personal task is created with. Everything else, including
# the project-flavoured state and stage, stays a PMO project-task field.
PERSONAL_CREATE_FIELDS = frozenset({
    'name', 'user_ids', 'date_deadline', 'priority', 'description', 'company_id', 'nasq_parent_id',
})
# Cursor-local marker minted only by the checked convert (nasq.my.task.convert); never a context flag.
CONVERT_MARKER = 'nasq_tasks_pmo.convert_scope'
# The only fields the checked convert writes beyond PMO's whitelist: the project of the task and the
# move of its personal sub-tasks from nasq_parent_id to Odoo's parent_id.
CONVERT_WRITE_FIELDS = frozenset({'project_id', 'nasq_parent_id', 'parent_id'})
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

    def _nasq_extra_write_fields(self):
        """Open the project assignment fields for the tasks of the running convert only.

        The marker holds the caller, the company and the ids the convert checked
        (the personal task and its sub-tasks); PMO's visibility and write checks
        still run on those tasks.
        """
        extra = super()._nasq_extra_write_fields()
        scope = self.env.cr.precommit.data.get(CONVERT_MARKER)
        if (
            scope
            and self.ids
            and scope[:2] == (self.env.uid, self.env.company.id)
            and set(self.ids) <= scope[2]
        ):
            extra = extra | CONVERT_WRITE_FIELDS
        return extra

    @api.model
    def _nasq_personal_read_allowed(self, domain=None, records=None):
        """Let a caller with ``tasks.tasks.read`` but no ``pmo.tasks.read`` reach personal tasks only.

        A search domain counts only when personal tasks are anchored at its top level
        (an AND containing ``nasq_personal = True``): an OR or an unanchored domain
        falls back to PMO's gate. For records, every one must be a personal task the
        record rules show to the caller.
        """
        if not self.env['nasq.access.service']._nasq_has_capability(self.env.user, 'tasks.tasks.read'):
            return super()._nasq_personal_read_allowed(domain=domain, records=records)
        if domain is not None:
            if _anchors_personal(domain):
                return True
        elif not records:
            # The model-level check stock _search makes after the domain gate above.
            return True
        elif all(isinstance(record_id, int) for record_id in records.ids):
            personal = self.browse(self._search(
                [('id', 'in', records.ids), ('nasq_personal', '=', True)], active_test=False))
            if personal == records:
                return True
        return super()._nasq_personal_read_allowed(domain=domain, records=records)

    def _nasq_can_write(self):
        """A personal task is written under ``tasks.tasks.write``; project tasks keep PMO's rule."""
        self.ensure_one()
        if self.nasq_personal and self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'tasks.tasks.write',
        ):
            return True
        return super()._nasq_can_write()


def _anchors_personal(domain):
    """Whether ``domain`` is an AND (or one condition) that includes ``nasq_personal = True``."""
    try:
        domain = Domain(domain)
    except (TypeError, ValueError):
        return False
    conditions = domain.children if isinstance(domain, DomainAnd) else (domain,)
    return any(
        isinstance(condition, DomainCondition)
        and condition.field_expr == 'nasq_personal'
        and (
            (condition.operator == '=' and condition.value is True)
            or (condition.operator == 'in' and list(condition.value) == [True])
        )
        for condition in conditions
    )
