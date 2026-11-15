# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ProjectTaskLead(models.Model):
    _inherit = 'project.task'

    # The opportunity a follow-up task was created on. Deleting the opportunity leaves the task: it is
    # a record of the tasks application and stays as a plain personal task. Archiving changes nothing.
    # Only the bridge's create route sets it (a creation default of the tasks service), so no client
    # write reaches it: personal tasks only take their own fields.
    lead_id = fields.Many2one('crm.lead', string='Opportunity', ondelete='set null',
                              index='btree_not_null', copy=False)
