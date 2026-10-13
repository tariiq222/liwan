# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqHrEntitlementService(models.AbstractModel):
    _inherit = 'nasq.entitlement.service'

    @api.model
    def _nasq_terminology_keys(self):
        return super()._nasq_terminology_keys() | frozenset({
            'nav.organization',
            'nav.employees',
            'nav.departments',
            'nav.documents',
            'hr.directory.title',
            'hr.depts.title',
            'hr.docs.title',
        })
