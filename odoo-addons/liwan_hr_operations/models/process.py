# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

from .common import APPROVER, KIND, LEAVE_APPROVE, OFFICERS


class HrOperationsProcess(models.Model):
    _inherit = 'liwan.operation.process'

    @api.model
    def _operations_execution_kinds(self):
        kinds = super()._operations_execution_kinds()
        service = self.env['liwan.entitlement.service']
        if service._liwan_feature_write('hr.enabled') and service._liwan_feature_write('operations.enabled'):
            return (*kinds, {'key': KIND, 'label': self.env._('Leave request')})
        return kinds

    @api.model
    def _operations_application_kinds(self):
        return (*super()._operations_application_kinds(), KIND)

    @api.model
    def _operations_reviewer_resolvers(self, execution_kind):
        resolvers = super()._operations_reviewer_resolvers(execution_kind)
        if execution_kind != KIND:
            return resolvers
        return (
            *resolvers,
            {'key': APPROVER, 'label': self.env._('Direct manager (time-off approver)'), 'capability': 'operations.requests.read', 'skip_when_empty': True},
            {'key': OFFICERS, 'label': self.env._('HR leave officers'), 'capability': LEAVE_APPROVE},
        )

    @api.model
    def _hr_leave_governing_process(self, company):
        """The company's single published leave approval process, else an empty recordset."""
        return self.search([('company_id', '=', company.id), ('execution_kind', '=', KIND), ('state', '=', 'published')], limit=1)

    @api.model
    def _hr_leave_default_process(self):
        """Values and stages of the default process: the direct manager, then HR."""
        values = {'name': self.env._('Leave approval'), 'description': '', 'execution_kind': KIND, 'purpose': 'employee'}
        steps = [
            {'name': self.env._('Direct manager'), 'reviewer_ids': [], 'resolver': APPROVER},
            {'name': self.env._('HR'), 'reviewer_ids': [], 'resolver': OFFICERS},
        ]
        return values, steps

    @api.model
    def _hr_leave_is_being_edited(self, company):
        """Whether the company has a leave approval process in draft and none published."""
        return not self._hr_leave_governing_process(company) and bool(self.search_count([('company_id', '=', company.id), ('execution_kind', '=', KIND), ('state', '=', 'draft')]))

    def _publish(self, revision):
        if self.execution_kind == KIND and self.step_ids:
            # One published leave process per company even when two publishes race: the second waits for the
            # company row, then sees the first in the count below.
            self.company_id.lock_for_update()
            self._hr_leave_check_publishable()
        return super()._publish(revision)

    def _hr_leave_check_publishable(self):
        if self.purpose != 'employee':
            raise ValidationError(self.env._('A leave approval process is an employee affairs process.'))
        if self.search_count([('company_id', '=', self.company_id.id), ('execution_kind', '=', KIND), ('state', '=', 'published'), ('id', '!=', self.id)]):
            raise ValidationError(self.env._('The company already has a published leave approval process. Archive it first.'))
        service = self.env['liwan.access.service']
        steps = self.step_ids.sorted('sequence')
        for step in steps:
            final = step == steps[-1]
            if step.reviewer_resolver:
                if step.reviewer_resolver not in ((OFFICERS,) if final else (APPROVER, OFFICERS)):
                    raise ValidationError(self.env._('The last stage must be the HR leave officers or named users who can approve leave.') if final else self.env._('This reviewer resolver is not available.'))
            elif not all(service._liwan_has_capability(user, LEAVE_APPROVE, company=self.company_id) for user in step.reviewer_ids):
                raise ValidationError(self.env._('Named reviewers of a leave approval stage must be able to approve leave.'))
