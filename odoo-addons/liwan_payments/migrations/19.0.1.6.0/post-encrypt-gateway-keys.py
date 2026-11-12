# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api
from odoo.exceptions import UserError

from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_payments.models.payment_provider import (
    ENCRYPTED_KEY_FIELDS,
    SECRET_PURPOSE,
)


def _encrypt(env, value):
    try:
        return secret_box.encrypt(env, SECRET_PURPOSE, value)
    except UserError as error:
        raise UserError(
            f"Paymob keys are stored and must be encrypted: set {secret_box.KEY_ENV} to the platform secret "
            "storage key (urlsafe base64 of 32 bytes) and run the upgrade again.",
        ) from error


def migrate(cr, version):
    """Move the plain Paymob keys into their ciphertext columns and empty the plain ones.

    The plain columns are stock payment_paymob's own (its neutralize.sql writes them and a fresh
    install creates them before this addon turns the fields into computed ones), so they are
    emptied here, not dropped. A row whose plain column is empty or NULL is skipped, which makes a rerun safe.
    """
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for plain_column, encrypted_column in ENCRYPTED_KEY_FIELDS.items():
        cr.execute(f'SELECT id, {plain_column} FROM payment_provider WHERE {plain_column} <> \'\'')
        for provider_id, value in cr.fetchall():
            cr.execute(
                f'UPDATE payment_provider SET {encrypted_column} = %s WHERE id = %s',
                (_encrypt(env, value), provider_id),
            )
    cr.execute('UPDATE payment_provider SET paymob_secret_key = NULL, paymob_hmac_key = NULL, paymob_api_key = NULL')
