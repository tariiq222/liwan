"""What the agent signs: the Odoo event request (design 4.5) and the recording link (design 4.4).

Both use the two derived company keys of design 12.6. An event signature covers ``<timestamp>\\n<body>`` so the
exact bytes Odoo receives are the bytes that were signed; a recording token carries only the call id, the company
host and its expiry, and its signature covers the encoded payload it travels with.

Key form: Odoo derives each key as 64 hex characters. That text is the key's *encoding*, not its bytes: the HMAC key
is the 32 raw bytes obtained with ``bytes.fromhex``, never the 64 ASCII characters. This module only ever receives
those 32 bytes. ``tests/test_signing.py`` pins a shared vector (key text, payload, timestamp, signature hex) so the
Odoo side can reproduce these bytes exactly.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re

EVENT_TIMESTAMP_HEADER = "X-Liwan-Telephony-Timestamp"
EVENT_SIGNATURE_HEADER = "X-Liwan-Telephony-Signature"
CALL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
TOKEN_FIELDS = frozenset({"call", "host", "exp"})


def canonical_json(payload: dict) -> bytes:
    """The one serialization both the queue and the signature use: sorted keys, no spaces, UTF-8."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def event_signature(key: bytes, timestamp: int, body: bytes) -> str:
    """Hex HMAC-SHA256 over ``b"<timestamp>\\n<body>"``."""
    message = str(timestamp).encode("ascii") + b"\n" + body
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def event_headers(key: bytes, body: bytes, timestamp: int) -> dict[str, str]:
    return {
        EVENT_TIMESTAMP_HEADER: str(timestamp),
        EVENT_SIGNATURE_HEADER: event_signature(key, timestamp, body),
    }


def recording_token(key: bytes, *, call_id: str, host: str, expires_at: int) -> str:
    """``<base64url payload>.<hex signature>``; Odoo mints it, the agent verifies it. One minute is Odoo's choice."""
    if not CALL_ID.fullmatch(call_id):
        msg = "a recording token needs a call id of letters, digits, dot, underscore or hyphen"
        raise ValueError(msg)
    payload = canonical_json({"call": call_id, "host": host, "exp": int(expires_at)})
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")
    signature = hmac.new(key, encoded.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def verify_recording_token(key: bytes, token: str, *, host: str, now: int) -> dict | None:
    """The payload of a valid token, or ``None`` for anything wrong: shape, signature, expiry, host or call id.

    Every rejection is the same ``None``, including a token that is not ASCII, so a malformed link is a 404 and
    never an error the caller can tell apart from another.
    """
    if not isinstance(token, str) or token.count(".") != 1:
        return None
    encoded, signature = token.split(".")
    try:
        expected = hmac.new(key, encoded.encode("ascii"), hashlib.sha256).hexdigest()
        matched = hmac.compare_digest(expected, signature)
    except (UnicodeEncodeError, TypeError):
        return None
    if not matched:
        return None
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, binascii.Error):
        return None
    if not isinstance(payload, dict) or set(payload) != TOKEN_FIELDS:
        return None
    call_id, token_host, expires_at = payload["call"], payload["host"], payload["exp"]
    if not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id):
        return None
    if not isinstance(token_host, str) or token_host.lower() != host.lower():
        return None
    if not isinstance(expires_at, int) or isinstance(expires_at, bool) or expires_at <= now:
        return None
    return payload
