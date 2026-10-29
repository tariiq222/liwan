# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    env['webvue.tenant.profile']._webvue_ensure_root_company()._webvue_apply_accounting_baseline()
