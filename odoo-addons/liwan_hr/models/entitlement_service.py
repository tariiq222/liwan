# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .warning_type import SEED_CONTEXT, SEED_TOKEN


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

    @api.model
    def _liwan_read_only_allowances(self):
        # The first visit of a warnings manager seeds the company's warning types, on a read.
        allowances = super()._liwan_read_only_allowances()
        return {**allowances, 'seed': {**allowances['seed'], SEED_CONTEXT: SEED_TOKEN}}
