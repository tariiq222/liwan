from __future__ import annotations

import base64
import hashlib
import hmac
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.signing import (  # noqa: E402
    DATABASE_HEADER,
    EVENT_SIGNATURE_HEADER,
    EVENT_TIMESTAMP_HEADER,
    REVERSE_MAX_SKEW_SECONDS,
    canonical_json,
    event_headers,
    event_signature,
    recording_token,
    reverse_headers,
    reverse_signature,
    turn_rest_credentials,
    verify_recording_token,
    verify_reverse_request,
)

KEY = bytes.fromhex("ab" * 32)
OTHER_KEY = bytes.fromhex("cd" * 32)
HOST = "acme.example.com"
CALL = "1700000000.42"

# The shared vector with the Odoo side. Odoo derives the key as 64 hex characters; the HMAC key is the 32 bytes
# obtained with bytes.fromhex, never the 64 ASCII characters. Odoo must produce VECTOR_BODY, VECTOR_SIGNATURE and
# VECTOR_TOKEN from these inputs byte for byte.
VECTOR_KEY_TEXT = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
VECTOR_KEY = bytes.fromhex(VECTOR_KEY_TEXT)
VECTOR_TIMESTAMP = 1764051600
VECTOR_CALL = "1700000000.1"
VECTOR_EXPIRES_AT = 1764051660
VECTOR_EVENT = {
    "database": "liwan_acme",
    "occurred_at": "2026-11-25T09:00:00Z",
    "source": "ari",
    "reconciled": False,
    "call": {
        "linkedid": VECTOR_CALL,
        "uniqueid": VECTOR_CALL,
        "channel": "PJSIP/1001-00000001",
        "direction": "in",
        "caller_number": "+966500000000",
        "connected_number": None,
        "dialed_exten": "1001",
        "state": "ringing",
        "started_at": "2026-11-25T09:00:00Z",
        "answered_at": None,
        "ended_at": None,
    },
    "event_id": "0f8fad5b-d9cb-469f-a165-70867728950e",
}
VECTOR_BODY = (
    b'{"call":{"answered_at":null,"caller_number":"+966500000000","channel":"PJSIP/1001-00000001",'
    b'"connected_number":null,"dialed_exten":"1001","direction":"in","ended_at":null,'
    b'"linkedid":"1700000000.1","started_at":"2026-11-25T09:00:00Z","state":"ringing",'
    b'"uniqueid":"1700000000.1"},"database":"liwan_acme",'
    b'"event_id":"0f8fad5b-d9cb-469f-a165-70867728950e","occurred_at":"2026-11-25T09:00:00Z",'
    b'"reconciled":false,"source":"ari"}'
)
VECTOR_SIGNATURE = "4bc19e0f01f014345316ffc3c06b91d7bed108125a2c20e1f6c0dc59953468d4"
VECTOR_TOKEN = (
    "eyJjYWxsIjoiMTcwMDAwMDAwMC4xIiwiZXhwIjoxNzY0MDUxNjYwLCJob3N0IjoiYWNtZS5leGFtcGxlLmNvbSJ9"
    ".d2b12600c8297ebefc5034de4dd41eaeffcf0b635f08c0ad1ec1f450bd8a7cba"
)

# Shared reverse-direction signing vector (Odoo -> pbx-agent).
REVERSE_VECTOR_KEY_HEX = "01" * 32
REVERSE_VECTOR_KEY = bytes.fromhex(REVERSE_VECTOR_KEY_HEX)
REVERSE_VECTOR_TIMESTAMP = "1700000000"
REVERSE_VECTOR_METHOD = "POST"
REVERSE_VECTOR_PATH = "/registration"
REVERSE_VECTOR_BODY = b'{"database":"liwan_acme","extension":"101"}'
REVERSE_VECTOR_SIGNATURE = "7ec49cf1d3253e1a030372f29a059d41b6de3577a419428dc0acd955a915236b"


class SharedVectorTest(unittest.TestCase):
    def test_the_body_is_the_pinned_vector(self) -> None:
        self.assertEqual(canonical_json(VECTOR_EVENT), VECTOR_BODY)

    def test_the_signature_is_the_pinned_vector(self) -> None:
        self.assertEqual(event_signature(VECTOR_KEY, VECTOR_TIMESTAMP, VECTOR_BODY), VECTOR_SIGNATURE)

    def test_the_token_is_the_pinned_vector(self) -> None:
        token = recording_token(VECTOR_KEY, call_id=VECTOR_CALL, host=HOST, expires_at=VECTOR_EXPIRES_AT)
        self.assertEqual(token, VECTOR_TOKEN)
        self.assertEqual(verify_recording_token(VECTOR_KEY, VECTOR_TOKEN, host=HOST, now=VECTOR_TIMESTAMP)["call"], VECTOR_CALL)

    def test_the_key_is_the_decoded_bytes_not_the_hex_text(self) -> None:
        self.assertEqual(len(VECTOR_KEY), 32)
        self.assertEqual(VECTOR_KEY.hex(), VECTOR_KEY_TEXT)
        ascii_signature = event_signature(VECTOR_KEY_TEXT.encode("ascii"), VECTOR_TIMESTAMP, VECTOR_BODY)
        self.assertNotEqual(ascii_signature, VECTOR_SIGNATURE)

    def test_the_reverse_signature_is_the_pinned_vector(self) -> None:
        sig = reverse_signature(
            REVERSE_VECTOR_KEY,
            timestamp=REVERSE_VECTOR_TIMESTAMP,
            method=REVERSE_VECTOR_METHOD,
            path=REVERSE_VECTOR_PATH,
            body=REVERSE_VECTOR_BODY,
        )
        self.assertEqual(sig, REVERSE_VECTOR_SIGNATURE)
        self.assertTrue(
            verify_reverse_request(
                REVERSE_VECTOR_KEY,
                timestamp=REVERSE_VECTOR_TIMESTAMP,
                signature=REVERSE_VECTOR_SIGNATURE,
                method=REVERSE_VECTOR_METHOD,
                path=REVERSE_VECTOR_PATH,
                body=REVERSE_VECTOR_BODY,
                now=int(REVERSE_VECTOR_TIMESTAMP),
            )
        )


class ReverseSignatureTest(unittest.TestCase):
    def test_accepts_valid_signature_including_uppercase_hex_and_boundary_skew(self) -> None:
        body = b'{"database":"liwan_acme","extension":"101"}'
        sig = reverse_signature(KEY, timestamp=1700000000, method="post", path="/registration", body=body)
        for now in (1700000000 - REVERSE_MAX_SKEW_SECONDS, 1700000000, 1700000000 + REVERSE_MAX_SKEW_SECONDS):
            self.assertTrue(
                verify_reverse_request(
                    KEY,
                    timestamp="1700000000",
                    signature=sig,
                    method="POST",
                    path="/registration",
                    body=body,
                    now=now,
                )
            )
        self.assertTrue(
            verify_reverse_request(
                KEY,
                timestamp="1700000000",
                signature=sig.upper(),
                method="POST",
                path="/registration",
                body=body,
                now=1700000000,
            )
        )

    def test_rejects_expired_and_future_timestamps(self) -> None:
        body = b""
        sig = reverse_signature(KEY, timestamp=1700000000, method="DELETE", path="/registration/101", body=body)
        self.assertFalse(
            verify_reverse_request(
                KEY,
                timestamp="1700000000",
                signature=sig,
                method="DELETE",
                path="/registration/101",
                body=body,
                now=1700000000 + REVERSE_MAX_SKEW_SECONDS + 1,
            )
        )
        self.assertFalse(
            verify_reverse_request(
                KEY,
                timestamp="1700000000",
                signature=sig,
                method="DELETE",
                path="/registration/101",
                body=body,
                now=1700000000 - REVERSE_MAX_SKEW_SECONDS - 1,
            )
        )

    def test_rejects_wrong_method_path_body_or_key(self) -> None:
        body = b'{"database":"liwan_acme","extension":"101"}'
        sig = reverse_signature(KEY, timestamp=1700000000, method="POST", path="/registration", body=body)
        self.assertFalse(
            verify_reverse_request(KEY, timestamp="1700000000", signature=sig, method="PUT", path="/registration", body=body, now=1700000000)
        )
        self.assertFalse(
            verify_reverse_request(KEY, timestamp="1700000000", signature=sig, method="POST", path="/extensions/101", body=body, now=1700000000)
        )
        self.assertFalse(
            verify_reverse_request(KEY, timestamp="1700000000", signature=sig, method="POST", path="/registration", body=body + b" ", now=1700000000)
        )
        self.assertFalse(
            verify_reverse_request(OTHER_KEY, timestamp="1700000000", signature=sig, method="POST", path="/registration", body=body, now=1700000000)
        )

    def test_rejects_malformed_headers(self) -> None:
        body = b"{}"
        sig = reverse_signature(KEY, timestamp=1700000000, method="POST", path="/registration", body=body)
        for bad_ts in (None, "", "-1", "1700000000.0", "abc", "1" * 21, "١٧٠٠٠٠٠٠٠٠"):
            self.assertFalse(
                verify_reverse_request(KEY, timestamp=bad_ts, signature=sig, method="POST", path="/registration", body=body, now=1700000000)
            )
        for bad_sig in (None, "", "a" * 63, "a" * 65, "g" * 64, "ت" * 64):
            self.assertFalse(
                verify_reverse_request(KEY, timestamp="1700000000", signature=bad_sig, method="POST", path="/registration", body=body, now=1700000000)
            )

    def test_reverse_headers_include_timestamp_signature_and_database(self) -> None:
        headers = reverse_headers(KEY, method="DELETE", path="/extensions/101", body=b"", database="liwan_acme", timestamp=1700000000)
        self.assertEqual(headers[EVENT_TIMESTAMP_HEADER], "1700000000")
        self.assertEqual(headers[DATABASE_HEADER], "liwan_acme")
        self.assertEqual(
            headers[EVENT_SIGNATURE_HEADER],
            reverse_signature(KEY, timestamp=1700000000, method="DELETE", path="/extensions/101", body=b""),
        )


class TurnRestCredentialsTest(unittest.TestCase):
    def test_matches_coturn_use_auth_secret_format(self) -> None:
        secret = "s" * 32
        username, credential = turn_rest_credentials(secret, "101", session_seconds=120, now=1700000000.7)
        self.assertEqual(username, "1700000300:101")
        expected = base64.b64encode(hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()).decode("ascii")
        self.assertEqual(credential, expected)

    def test_uses_double_session_seconds_when_larger_than_300(self) -> None:
        username, _credential = turn_rest_credentials("k" * 32, "202", session_seconds=200, now=1700000000)
        self.assertEqual(username, "1700000400:202")


class EventSignatureTest(unittest.TestCase):
    def test_the_signature_is_hmac_over_timestamp_and_body(self) -> None:
        body = b'{"a":1}'
        expected = hmac.new(KEY, b"1700000000\n" + body, hashlib.sha256).hexdigest()
        self.assertEqual(event_signature(KEY, 1700000000, body), expected)
        self.assertEqual(len(event_signature(KEY, 1700000000, body)), 64)

    def test_every_input_changes_the_signature(self) -> None:
        body = b'{"a":1}'
        self.assertNotEqual(event_signature(KEY, 1, body), event_signature(KEY, 2, body))
        self.assertNotEqual(event_signature(KEY, 1, body), event_signature(KEY, 1, b'{"a":2}'))
        self.assertNotEqual(event_signature(KEY, 1, body), event_signature(OTHER_KEY, 1, body))

    def test_the_headers_carry_the_timestamp_and_the_signature(self) -> None:
        body = b"{}"
        headers = event_headers(KEY, body, 1700000000)
        self.assertEqual(headers[EVENT_TIMESTAMP_HEADER], "1700000000")
        self.assertEqual(headers[EVENT_SIGNATURE_HEADER], event_signature(KEY, 1700000000, body))


class RecordingTokenTest(unittest.TestCase):
    def test_a_valid_token_names_its_call(self) -> None:
        token = recording_token(KEY, call_id=CALL, host=HOST, expires_at=1000)
        payload = verify_recording_token(KEY, token, host=HOST, now=999)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["call"], CALL)
        self.assertEqual(payload["host"], HOST)
        self.assertEqual(payload["exp"], 1000)

    def test_an_expired_token_is_refused(self) -> None:
        token = recording_token(KEY, call_id=CALL, host=HOST, expires_at=1000)
        self.assertIsNone(verify_recording_token(KEY, token, host=HOST, now=1000))
        self.assertIsNone(verify_recording_token(KEY, token, host=HOST, now=1001))

    def test_another_companys_host_is_refused(self) -> None:
        token = recording_token(KEY, call_id=CALL, host=HOST, expires_at=1000)
        self.assertIsNone(verify_recording_token(KEY, token, host="other.example.com", now=999))

    def test_a_token_for_another_call_travelling_as_this_one_is_refused(self) -> None:
        other = recording_token(KEY, call_id="1700000000.43", host=HOST, expires_at=1000)
        encoded, signature = other.split(".")
        # Swap the payload for this call's while keeping the original signature.
        forged = recording_token(KEY, call_id=CALL, host=HOST, expires_at=1000).split(".")[0] + "." + signature
        self.assertIsNone(verify_recording_token(KEY, forged, host=HOST, now=999))
        flipped = ("0" if signature[0] != "0" else "1") + signature[1:]
        self.assertIsNone(verify_recording_token(KEY, f"{encoded}.{flipped}", host=HOST, now=999))

    def test_another_key_is_refused(self) -> None:
        token = recording_token(OTHER_KEY, call_id=CALL, host=HOST, expires_at=1000)
        self.assertIsNone(verify_recording_token(KEY, token, host=HOST, now=999))

    def test_malformed_tokens_are_refused(self) -> None:
        for token in ("", ".", "one", "a.b.c", "not-base64.not-hex", "\u0000.\u0000"):
            self.assertIsNone(verify_recording_token(KEY, token, host=HOST, now=999))
        self.assertIsNone(verify_recording_token(KEY, None, host=HOST, now=999))

    def test_a_token_that_is_not_ascii_is_refused_not_raised(self) -> None:
        for token in ("تسجيل.abc", "é." + "0" * 64, "eyJjYWxs.توقيع", "abc.é"):
            self.assertIsNone(verify_recording_token(KEY, token, host=HOST, now=999))

    def test_a_token_for_an_unsafe_call_id_is_refused_before_it_is_signed(self) -> None:
        with self.assertRaises(ValueError):
            recording_token(KEY, call_id="../etc/passwd", host=HOST, expires_at=1000)


if __name__ == "__main__":
    unittest.main()
