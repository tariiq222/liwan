# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .models.res_company import GLOBAL_TAX_ROUNDING, SAUDI_COUNTRY_CODE


def post_init_hook(env):
    """Round the taxes of the Saudi companies that exist at install globally, as the create hook does for new ones.

    It runs before stock loads the ``sa`` chart at the end of the install, whose company write the Saudi rounding
    constraint checks.
    """
    companies = env['res.company'].search([])
    companies.filtered(lambda company: company.country_id.code == SAUDI_COUNTRY_CODE).write({
        'tax_calculation_rounding_method': GLOBAL_TAX_ROUNDING,
    })
