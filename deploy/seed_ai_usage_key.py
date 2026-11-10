# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Mint the one API key of the tenant's technical AI usage account and print it once. Usage, from provision.sh:

    odoo shell -c /etc/odoo/odoo.conf -d <db> --no-http < seed_ai_usage_key.py

The web server reports the AI usage of a finished run with this key, so the report does not depend on the user's session
still being valid (issue #557). Running it again revokes every key the account holds and mints a new one: that is the rotation.
The key is hex, belongs to ``liwan_ai.user_ai_usage`` (no password, no sign-in, one capability) and reaches one Odoo route,
``/api/v1/ai/usage/service``; ``odoo-addons/liwan_platform/models/ir_http.py`` refuses it everywhere else. The only line written to
standard output is ``LIWAN_AI_USAGE_KEY=<key>``, which provision.sh stores in deploy/.env (mode 600) without echoing it. The key
has no expiry, so it keeps working until it is rotated or the account is archived.
"""
recorder = env.ref('liwan_ai.user_ai_usage')  # noqa: F821
Keys = env['res.users.apikeys']  # noqa: F821
Keys.search([('user_id', '=', recorder.id)]).remove()
# ``sudo()`` here is the operator's own shell session (superuser already), needed only so Odoo accepts a key with no expiry.
key = Keys.with_user(recorder).sudo()._generate('rpc', 'LiwanOS AI usage recorder', None)
env.cr.commit()  # noqa: F821
print(f'LIWAN_AI_USAGE_KEY={key}')  # noqa: T201
