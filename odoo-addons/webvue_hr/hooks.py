# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    """Existing Saudi companies get the Sunday to Thursday default schedule once HR is installed."""
    env['res.company'].with_context(active_test=False).search([])._webvue_ensure_saudi_schedule()
