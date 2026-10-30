# Part of Odoo. See LICENSE file for full copyright and licensing details.


def currency_code(company):
    """The ISO code every payroll amount of ``company`` is in: payroll figures carry its currency, never a fixed one."""
    return company.currency_id.name
