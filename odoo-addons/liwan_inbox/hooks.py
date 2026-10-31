# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    """Every company starts with its settings row at the stated defaults, so reading the settings never writes (INB-201)."""
    settings = env['liwan.inbox.settings']
    for company in env['res.company'].search([]):
        settings._get_for_company(company)
