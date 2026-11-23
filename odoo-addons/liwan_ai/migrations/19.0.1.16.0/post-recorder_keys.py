# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Remove the usage recorder's stored API keys.

The recorder authenticates with a bearer derived per database from the deployment's ``LIWAN_AI_USAGE_KEY`` (models/usage_key.py);
a key minted into ``res_users_apikeys`` by an earlier deployment script now opens nothing, so it is deleted with the ORM.
"""
from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    recorder = env.ref('liwan_ai.user_ai_usage', raise_if_not_found=False)
    if recorder:
        env['res.users.apikeys'].search([('user_id', '=', recorder.id)]).unlink()
