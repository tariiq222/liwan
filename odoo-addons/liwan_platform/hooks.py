# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    env['liwan.tenant.profile']._liwan_ensure_root_company()._liwan_apply_accounting_baseline()
