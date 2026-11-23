# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The credential the Nuxt server reports AI usage with, derived per tenant database from one deployment secret.

``LIWAN_AI_USAGE_KEY`` is a root of 64 hex characters held by ``web`` and ``odoo`` only. The bearer sent on
``POST /api/v1/ai/usage/service`` is ``hex(HMAC-SHA256(key=bytes.fromhex(root), msg=LABEL + "\\n" + database))``, so one root
serves every database of a deployment while a bearer derived for one database is refused by every other. Nothing is stored in
the tenant database. Apps/web derives the same value (apps/web/server/utils/ai/recorder.ts) and a test there reads
``USAGE_KEY_LABEL`` from this file.
"""
import hashlib
import hmac
import os
import re

USAGE_KEY_ENV = 'LIWAN_AI_USAGE_KEY'
USAGE_KEY_LABEL = 'liwan-ai-usage/v1'
ROOT_PATTERN = re.compile(r'[0-9a-fA-F]{64}')


def usage_recordable():
    """Whether this process holds a well-formed root, so a run's usage can be recorded at all."""
    return bool(ROOT_PATTERN.fullmatch(os.environ.get(USAGE_KEY_ENV, '')))


def usage_bearer(database):
    """The bearer the usage recorder presents for ``database``, or ``None`` when no well-formed root is configured."""
    if not usage_recordable():
        return None
    root = bytes.fromhex(os.environ[USAGE_KEY_ENV])
    return hmac.new(root, f'{USAGE_KEY_LABEL}\n{database}'.encode(), hashlib.sha256).hexdigest()
