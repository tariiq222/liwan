# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    """Existing companies get the Sunday to Thursday schedule (Saudi ones), their payroll structure and their warning types once HR is installed."""
    companies = env['res.company'].with_context(active_test=False).search([])
    companies._liwan_ensure_saudi_schedule()
    companies._liwan_ensure_payroll_structure()
    companies._liwan_ensure_warning_types()
