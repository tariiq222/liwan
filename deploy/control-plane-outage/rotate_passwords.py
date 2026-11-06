# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Rotate the synthetic account credential through isolated Odoo ORM."""
import os

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

user = env['res.users'].sudo().search([('login', '=', os.environ['LIWAN_FIXTURE_ADMIN_LOGIN'])], limit=1)
if not user:
    raise RuntimeError('synthetic fixture user missing')
# No customer route sets a password any more: the isolated fixture shell writes it as the operator, the way
# tools/shared_saas_lifecycle/admin_password_effect.py sets the provisioned admin password.
operator = user.with_context(**{OPERATOR_CONTEXT: True})
operator.env['liwan.entitlement.service']._liwan_assert_operator()
operator.write({'password': os.environ['LIWAN_FIXTURE_ADMIN_PASSWORD']})
env.cr.commit()
print('synthetic account password rotated through the operator path')
