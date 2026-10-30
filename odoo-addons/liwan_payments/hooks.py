# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_payments.models.payments_settings import set_sale_parameters


def post_init_hook(env):
    set_sale_parameters(env)
