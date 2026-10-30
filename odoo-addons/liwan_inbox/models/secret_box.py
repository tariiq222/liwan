# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Encryption at rest of the channel secrets.

Fernet under a per-database key derived (HKDF-SHA256) from the operator master key in the
environment variable LIWAN_INBOX_SECRET_KEY (urlsafe base64 of 32 bytes). Without a valid
master key nothing can be stored or read: the caller gets a clear UserError.
"""
import base64
import binascii
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from odoo.exceptions import UserError

KEY_ENV = 'LIWAN_INBOX_SECRET_KEY'
MASTER_KEY_BYTES = 32


def _fernet(env):
    try:
        master = base64.urlsafe_b64decode(os.environ.get(KEY_ENV, '').encode())
    except (binascii.Error, ValueError):
        master = b''
    if len(master) != MASTER_KEY_BYTES:
        raise UserError(env._('Secret storage is not configured.'))
    derived = HKDF(
        algorithm=hashes.SHA256(), length=MASTER_KEY_BYTES, salt=None,
        info=b'liwan_inbox:' + env.cr.dbname.encode(),
    ).derive(master)
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(env, plain):
    return _fernet(env).encrypt(plain.encode()).decode()


def decrypt(env, token):
    try:
        return _fernet(env).decrypt(token.encode()).decode()
    except InvalidToken:
        raise UserError(env._('A stored secret cannot be decrypted with the configured key.')) from None
