# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError


class ResourceBookingTypeCombinationRel(models.Model):
    _inherit = 'resource.booking.type.combination.rel'

    @api.constrains('type_id', 'combination_id')
    def _check_type_company(self):
        for rel in self:
            if rel.type_id.company_id != rel.combination_id.company_id:
                raise ValidationError(self.env._(
                    'The combination %(combination)s belongs to %(combination_company)s but the type %(type)s belongs to %(type_company)s.',
                    combination=rel.combination_id.display_name,
                    combination_company=rel.combination_id.company_id.display_name,
                    type=rel.type_id.name,
                    type_company=rel.type_id.company_id.display_name,
                ))
