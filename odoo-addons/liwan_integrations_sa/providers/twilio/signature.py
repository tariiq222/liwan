# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio callback signatures: `X-Twilio-Signature` is the base64 HMAC-SHA1, keyed by the auth token, of the exact
callback URL followed by every POST parameter's name and value, sorted by name, with no delimiter
(https://www.twilio.com/docs/usage/webhooks/webhooks-security). Pure functions.
"""
import base64
import hashlib
import hmac

HEADER = 'X-Twilio-Signature'


def _pairs(params):
    """``(name, value)`` of a form, every value of a repeated name, sorted by name then value as Twilio's libraries do."""
    pairs = []
    for name, value in params.items():
        values = value if isinstance(value, (list, tuple)) else [value]
        pairs.extend((str(name), '' if item is None else str(item)) for item in values)
    return sorted(pairs)


def compute(auth_token, url, params):
    data = url + ''.join(f'{name}{value}' for name, value in _pairs(params))
    digest = hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def verify(auth_token, url, params, signature):
    """Whether ``signature`` is Twilio's signature of ``url`` and ``params``; compared in constant time."""
    if not auth_token or not url or not isinstance(signature, str) or not signature:
        return False
    return hmac.compare_digest(compute(auth_token, url, params).encode(), signature.encode())
