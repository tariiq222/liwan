# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ProjectTaskTicket(models.Model):
    _inherit = 'project.task'

    # The ticket a follow-up task was created on. Deleting the ticket leaves the task: it is a record of the tasks
    # application and stays as a plain personal task. Only the bridge's create route sets it, as a registered link
    # field of the tasks service, so no client write reaches it.
    liwan_helpdesk_ticket_id = fields.Many2one(
        'helpdesk.ticket', string='Support ticket', ondelete='set null', index='btree_not_null', copy=False,
    )

    @api.model
    def _liwan_task_link_fields(self):
        return super()._liwan_task_link_fields() | {'liwan_helpdesk_ticket_id'}
