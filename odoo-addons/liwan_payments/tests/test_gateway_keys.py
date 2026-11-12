# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import PAYMOB_CREDENTIALS, LiwanPaymentsCase
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_payments.models.payment_provider import (
    ENCRYPTED_KEY_FIELDS,
    SECRET_PURPOSE,
)

SECRETS = {field: PAYMOB_CREDENTIALS[field] for field in ENCRYPTED_KEY_FIELDS}


@tagged('post_install', '-at_install', 'liwan')
class TestGatewayKeys(LiwanPaymentsCase):
    """The Paymob keys are ciphertext in the database and plaintext only to code that reads the stock fields."""

    def stored(self):
        self.env.flush_all()
        columns = [*ENCRYPTED_KEY_FIELDS, *ENCRYPTED_KEY_FIELDS.values()]
        self.env.cr.execute(f"SELECT {', '.join(columns)} FROM payment_provider WHERE id = %s", [self.paymob.id])
        return dict(zip(columns, self.env.cr.fetchone(), strict=True))

    def set_keys(self):
        self.paymob.with_user(self.admin)._liwan_payments_set_credentials(PAYMOB_CREDENTIALS)
        self.env.invalidate_all()

    def test_the_keys_are_stored_as_ciphertext_and_the_plain_columns_stay_empty(self):
        self.set_keys()
        row = self.stored()
        for field, encrypted in ENCRYPTED_KEY_FIELDS.items():
            with self.subTest(field=field):
                self.assertIsNone(row[field])
                self.assertNotEqual(row[encrypted], SECRETS[field])
                self.assertEqual(secret_box.decrypt(self.env, SECRET_PURPOSE, row[encrypted]), SECRETS[field])

    def test_code_reading_the_stock_fields_gets_the_plain_keys(self):
        self.set_keys()
        provider = self.paymob.sudo()
        self.assertEqual({field: provider[field] for field in SECRETS}, SECRETS)

    def test_clearing_a_key_clears_its_ciphertext(self):
        self.set_keys()
        self.paymob.sudo().paymob_api_key = False
        row = self.stored()
        self.assertIsNone(row['liwan_paymob_api_key_enc'])
        self.assertIsNotNone(row['liwan_paymob_hmac_key_enc'])
        self.assertEqual(self.paymob.sudo().paymob_hmac_key, SECRETS['paymob_hmac_key'])

    def test_the_api_reports_presence_only_and_never_a_key_or_its_ciphertext(self):
        self.set_keys()
        present = self.paymob._liwan_payments_credentials_present()
        self.assertTrue(all(present[field] is True for field in ENCRYPTED_KEY_FIELDS))
        self.login_admin()
        text = json.dumps(self.api('GET', '/api/v1/payments/providers').json())
        row = self.stored()
        for value in (*SECRETS.values(), *(row[encrypted] for encrypted in ENCRYPTED_KEY_FIELDS.values())):
            self.assertNotIn(value, text)

    def test_presence_does_not_decrypt(self):
        self.set_keys()
        with patch.object(secret_box, 'decrypt') as decrypt:
            self.paymob._liwan_payments_credentials_present()
        decrypt.assert_not_called()

    def test_without_the_master_key_nothing_is_stored(self):
        with patch.dict('os.environ', {secret_box.KEY_ENV: ''}), self.assertRaises(UserError):
            self.paymob.sudo().paymob_hmac_key = 'never_stored'

    def test_the_migration_encrypts_plain_keys_and_empties_the_stock_columns(self):
        path = Path(__file__).parents[1] / 'migrations' / '19.0.1.6.0' / 'post-encrypt-gateway-keys.py'
        spec = importlib.util.spec_from_file_location('post_encrypt_gateway_keys', path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE payment_provider SET paymob_secret_key = %s, paymob_hmac_key = %s, paymob_api_key = %s,'
            ' liwan_paymob_secret_key_enc = NULL, liwan_paymob_hmac_key_enc = NULL, liwan_paymob_api_key_enc = NULL'
            ' WHERE id = %s',
            [SECRETS['paymob_secret_key'], SECRETS['paymob_hmac_key'], SECRETS['paymob_api_key'], self.paymob.id],
        )
        migration.migrate(self.env.cr, '19.0.1.5.0')
        migration.migrate(self.env.cr, '19.0.1.5.0')
        self.env.invalidate_all()
        row = self.stored()
        for plain, encrypted in ENCRYPTED_KEY_FIELDS.items():
            self.assertIsNone(row[plain])
            self.assertEqual(secret_box.decrypt(self.env, SECRET_PURPOSE, row[encrypted]), SECRETS[plain])
        self.assertEqual(self.paymob.sudo().paymob_hmac_key, SECRETS['paymob_hmac_key'])
