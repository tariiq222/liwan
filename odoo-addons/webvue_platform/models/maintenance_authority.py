# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .maintenance import lock_records, maintenance_company


class WebVueMaintenanceAuthority(models.Model):
    _name = 'webvue.maintenance.authority'
    _description = 'Tenant maintenance serialization authority'
    _webvue_scope = 'company'
    _check_company_auto = True

    company_id = fields.Many2one('res.company', required=True, ondelete='restrict', index=True)
    operation_generation = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'One maintenance authority per tenant.')
    _positive_generation = models.Constraint('CHECK(operation_generation > 0)', 'Maintenance operation generation must be positive.')

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(self.env._('Maintenance authority can only be changed by an authorized maintenance operation.'))

    def write(self, vals):
        raise AccessError(self.env._('Maintenance authority can only be changed by an authorized maintenance operation.'))

    def unlink(self):
        raise AccessError(self.env._('Maintenance authority cannot be deleted.'))

    @api.model
    def _webvue_serialize(self, *, operator=False):
        """Establish a write dependency before any scheduling decision.

        Odoo uses REPEATABLE READ. A lock on an unchanged company row does not
        refresh a pre-existing snapshot and cannot protect a predicate such as
        'no overlapping booking'. A flushed update to this shared authority
        makes stale concurrent snapshots fail serialization. Odoo's request
        retry then re-evaluates the operation using the committed current data.
        The unique company constraint also rejects the first-row creation race.
        """
        company = maintenance_company(self.env, operator=operator)
        lock_records(company)
        authority = self.search([('company_id', '=', company.id)], limit=1)
        if authority:
            super(WebVueMaintenanceAuthority, authority).write({
                'operation_generation': authority.operation_generation + 1,
            })
        else:
            authority = super().create({'company_id': company.id, 'operation_generation': 1})
        authority.flush_recordset(['operation_generation'])
        return company
