# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueHrEntitlementService(models.AbstractModel):
    _inherit = 'webvue.entitlement.service'

    @api.model
    def _webvue_terminology_keys(self):
        return super()._webvue_terminology_keys() | frozenset({
            'nav.organization',
            'nav.employees',
            'nav.departments',
            'nav.documents',
            'hr.directory.title',
            'hr.depts.title',
            'hr.docs.title',
        })
