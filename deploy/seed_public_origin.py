# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pin the tenant's public origin to https://$DOMAIN and freeze it. Usage, from provision.sh after the
install and again after every DOMAIN change (``provision.sh --public-origin``):

    DOMAIN=… odoo shell -c /etc/odoo/odoo.conf -d <db> --no-http < seed_public_origin.py
"""
import os

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

profile = env.ref('webvue_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True})  # noqa: F821
profile._webvue_set_public_origin(os.environ['DOMAIN'])
env.cr.commit()  # noqa: F821
print('public origin:', env['ir.config_parameter'].get_param('web.base.url'))  # noqa: F821, T201
