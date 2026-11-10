# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


class LiwanPlatformResCompany(models.Model):
    _inherit = 'res.company'

    liwan_branch_ids = fields.One2many('liwan.tenant.branch', 'company_id', string='LiwanOS branch binding')
    # True for the company of a branch above the purchased limit; the ORM guard refuses writes to its records.
    liwan_read_only = fields.Boolean(compute='_compute_liwan_read_only')

    @api.depends('liwan_branch_ids.read_only')
    def _compute_liwan_read_only(self):
        # One query for the whole set: the guard asks this on every write of a company-bound record, and the
        # read must work for any acting user, whose ACL on the branch table is read-only or absent.
        self.env['liwan.tenant.branch'].flush_model(['company_id', 'read_only'])
        self.env.cr.execute(
            'SELECT company_id FROM liwan_tenant_branch WHERE read_only AND company_id = ANY(%s)',
            [self.ids or [0]],
        )
        flagged = {row[0] for row in self.env.cr.fetchall()}
        for company in self:
            company.liwan_read_only = company.id in flagged

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su and any(vals.get('parent_id') for vals in vals_list):
            msg = 'branch_requires_subscription'
            raise AccessError(msg)
        return super().create(vals_list)
