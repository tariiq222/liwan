# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_inbox.models.constants import SECRET_PURPOSE


def migrate(cr, version):
    """The webhook handshake token is a secret: encrypt the stored plain values into `verify_token_enc`."""
    if not version:
        return
    cr.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'liwan_inbox_channel' AND column_name = 'verify_token'",
    )
    if not cr.fetchone():
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    cr.execute('SELECT id, verify_token FROM liwan_inbox_channel WHERE verify_token IS NOT NULL')
    for channel_id, token in cr.fetchall():
        cr.execute(
            'UPDATE liwan_inbox_channel SET verify_token_enc = %s WHERE id = %s',
            (secret_box.encrypt(env, SECRET_PURPOSE, token), channel_id),
        )
    cr.execute('ALTER TABLE liwan_inbox_channel DROP COLUMN verify_token')
