# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanHrEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_terminology_keys(self):
        return super()._liwan_terminology_keys() | frozenset({
            'nav.organization',
            'nav.employees',
            'nav.departments',
            'hr.directory.title',
            'hr.depts.title',
        })
