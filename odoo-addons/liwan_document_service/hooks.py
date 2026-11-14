# Part of Odoo. See LICENSE file for full copyright and licensing details.


def post_init_hook(env):
    env['liwan.document']._liwan_bootstrap_libraries()
