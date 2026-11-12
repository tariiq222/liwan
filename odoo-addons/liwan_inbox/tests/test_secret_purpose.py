# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Channel secrets stored before the secret box moved to liwan_core still decrypt."""
import base64
import os

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from odoo.tests import tagged

from .common import LiwanInboxCase
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_inbox.models.constants import SECRET_PURPOSE


@tagged('post_install', '-at_install', 'liwan')
class TestSecretPurpose(LiwanInboxCase):

    def test_a_token_from_the_original_inbox_derivation_decrypts(self):
        master = base64.urlsafe_b64decode(os.environ[secret_box.KEY_ENV].encode())
        derived = HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None, info=b'liwan_inbox:' + self.env.cr.dbname.encode(),
        ).derive(master)
        token = Fernet(base64.urlsafe_b64encode(derived)).encrypt(b'stored-before-the-move').decode()
        self.assertEqual(secret_box.decrypt(self.env, SECRET_PURPOSE, token), 'stored-before-the-move')
