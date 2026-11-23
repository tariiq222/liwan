# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import os
from unittest.mock import patch

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_core.models import secret_box

MASTER = base64.urlsafe_b64encode(b'\x07' * 32).decode()
PURPOSE = 'liwan.test.purpose'


def derived_fernet(purpose, database_uuid):
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None,
        info=purpose.encode() + b':' + database_uuid.encode(),
    ).derive(base64.urlsafe_b64decode(MASTER))
    return Fernet(base64.urlsafe_b64encode(key))


@tagged('post_install', '-at_install')
class SecretBoxCase(TransactionCase):

    def setUp(self):
        super().setUp()
        patcher = patch.dict(os.environ, {secret_box.KEY_ENV: MASTER})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.params = self.env['ir.config_parameter']
        self.uuid = self.params._get_param('database.uuid')

    def test_token_is_bound_to_the_database_uuid(self):
        token = secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        self.assertEqual(derived_fernet(PURPOSE, self.uuid).decrypt(token.encode()), b'secret-value')
        self.assertEqual(secret_box.decrypt(self.env, PURPOSE, token), 'secret-value')

    def test_changed_uuid_cannot_decrypt(self):
        token = secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        self.params.set_param('database.uuid', 'another-database-identity')
        with self.assertRaises(UserError):
            secret_box.decrypt(self.env, PURPOSE, token)

    def test_empty_uuid_refuses_encrypt_and_decrypt(self):
        token = secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        self.params.set_param('database.uuid', '')
        with self.assertRaises(UserError):
            secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        with self.assertRaises(UserError):
            secret_box.decrypt(self.env, PURPOSE, token)

    def test_other_purpose_cannot_decrypt(self):
        token = secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        with self.assertRaises(UserError):
            secret_box.decrypt(self.env, 'liwan.other.purpose', token)

    def test_internal_user_and_public_user_can_round_trip(self):
        token = secret_box.encrypt(self.env, PURPOSE, 'secret-value')
        internal = self.env['res.users'].create({
            'name': 'Secret Box Internal', 'login': 'secret_box_internal',
            'group_ids': [(6, 0, [self.env.ref('base.group_user').id])],
        })
        for user in (internal, self.env.ref('base.public_user')):
            env = self.env(user=user)
            self.assertEqual(secret_box.decrypt(env, PURPOSE, token), 'secret-value')
            self.assertEqual(
                secret_box.decrypt(env, PURPOSE, secret_box.encrypt(env, PURPOSE, 'again')), 'again')
