# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Rotate the synthetic account credential through isolated Odoo ORM."""
import os

user = env['res.users'].sudo().search([('login', '=', os.environ['LIWAN_FIXTURE_ADMIN_LOGIN'])], limit=1)
admin = env['res.users'].sudo().search([('login', '=', 'admin')], limit=1)
if not user:
    raise RuntimeError('synthetic fixture user missing')
# Use an isolated local system-admin operator context only for this scratch DB;
# the synthetic account's explicit assignment grants password-reset capability.
env.invalidate_all()
user = env['res.users'].sudo().search([('login', '=', os.environ['LIWAN_FIXTURE_ADMIN_LOGIN'])], limit=1)
service = env['liwan.access.service'].with_user(user)
expected_version = service._liwan_user_version(user)
service._liwan_reset_password(user, os.environ['LIWAN_FIXTURE_ADMIN_PASSWORD'], expected_version)
env.cr.commit()
print('synthetic account password rotated through supported reset path')
