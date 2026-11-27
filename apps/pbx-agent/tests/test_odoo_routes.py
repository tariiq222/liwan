"""The private routes Odoo calls on pbx-agent (design 4.1, 4.4, 12.6).

Every route requires reverse-direction HMAC-SHA256 authentication (``X-Liwan-Telephony-Timestamp``,
``X-Liwan-Telephony-Signature`` and ``X-Liwan-Telephony-Database``). Raw ``X-Liwan-Key`` is no longer accepted.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import quote

from fakes import AriRequest, FakeAri, FakePbxStore
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.app import create_app  # noqa: E402
from pbx_agent.ari import AriClient  # noqa: E402
from pbx_agent.settings import Settings  # noqa: E402
from pbx_agent.signing import (  # noqa: E402
    DATABASE_HEADER,
    EVENT_SIGNATURE_HEADER,
    EVENT_TIMESTAMP_HEADER,
    reverse_headers,
    verify_recording_token,
)

KEY = bytes.fromhex("cd" * 32)
OTHER = bytes.fromhex("ef" * 32)
TURN_SECRET = "t" * 32
NOW = 1700000000


def make_settings(tmp: Path) -> Settings:
    recordings = tmp / "monitor"
    recordings.mkdir(exist_ok=True)
    return Settings(
        ari_url="http://ari.test:8088/ari",
        ari_username="liwan",
        ari_password="secret",
        pbx_db_url="postgresql://pbx:secret@pbx-db:5432/telephony_pbx",
        database="liwan_acme",
        events_key=bytes.fromhex("ab" * 32),
        reverse_key=KEY,
        recordings_dir=recordings,
        recordings_min_free_bytes=0,
        odoo_events_url="http://odoo.test/api/v1/telephony/events",
        listen_host="127.0.0.1",
        listen_port=8601,
        queue_path=tmp / "queue.sqlite3",
        reconcile_seconds=300,
        public_host="acme.example.test",
        cel_path=tmp / "cel.csv",
        inbound_context="from-trunk",
        line_endpoint=None,
        public_ws_url="wss://acme.example.test/ws",
        stun_url="stun:stun.example.test:3478",
        turn_url="turns:turn.example.test:5349",
        turn_secret=TURN_SECRET,
        session_seconds=120,
        session_overlap_seconds=30,
        pjsip_transport="transport-ws",
        pjsip_context="from-extension",
    )


def signed_request(
    client: TestClient,
    method: str,
    path: str,
    *,
    payload: dict | None = None,
    raw_body: bytes | None = None,
    key: bytes = KEY,
    database: str = "liwan_acme",
    timestamp: int = NOW,
    extra_headers: dict[str, str] | None = None,
):
    if raw_body is None:
        raw_body = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = reverse_headers(key, method=method, path=path, body=raw_body, database=database, timestamp=timestamp)
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    return client.request(method, path, content=raw_body, headers=headers)


class RoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch("pbx_agent.app.AriListener.run_forever", side_effect=lambda stop: stop.wait())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.root = Path(self.tmp.name)
        self.now = float(NOW)
        self.settings = make_settings(self.root)
        self.ari = FakeAri()
        self.store = FakePbxStore()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        app = create_app(self.settings, AriClient(self.ari), pbx_store=self.store, clock=lambda: self.now)
        self.client = stack.enter_context(TestClient(app))

    def test_unauthenticated_and_legacy_x_liwan_key_requests_are_refused(self) -> None:
        payload = {"extension": "101", "database": "liwan_acme"}
        # Missing headers -> 401
        answer = self.client.post("/registration", json=payload)
        self.assertEqual(answer.status_code, 401)
        # Legacy X-Liwan-Key -> 401 (no parallel legacy path)
        legacy = self.client.post("/registration", json=payload, headers={"X-Liwan-Key": KEY.hex()})
        self.assertEqual(legacy.status_code, 401)
        self.assertEqual(self.store.calls, [])
        self.assertEqual(self.ari.requests, [])

    def test_bad_signature_wrong_key_and_stale_or_future_timestamp_return_401(self) -> None:
        payload = {"extension": "101", "database": "liwan_acme"}
        # Wrong key
        self.assertEqual(signed_request(self.client, "POST", "/registration", payload=payload, key=OTHER).status_code, 401)
        # Bad signature
        self.assertEqual(
            signed_request(
                self.client,
                "POST",
                "/registration",
                payload=payload,
                extra_headers={EVENT_SIGNATURE_HEADER: "0" * 64},
            ).status_code,
            401,
        )
        # Stale (>300s) and future (>300s) timestamps
        self.assertEqual(signed_request(self.client, "POST", "/registration", payload=payload, timestamp=NOW - 301).status_code, 401)
        self.assertEqual(signed_request(self.client, "POST", "/registration", payload=payload, timestamp=NOW + 301).status_code, 401)
        # Missing database header -> 401
        raw = json.dumps(payload).encode("utf-8")
        headers = reverse_headers(KEY, method="POST", path="/registration", body=raw, database="liwan_acme", timestamp=NOW)
        del headers[DATABASE_HEADER]
        self.assertEqual(self.client.post("/registration", content=raw, headers=headers).status_code, 401)
        # Signed for wrong path -> 401
        wrong_path_headers = reverse_headers(KEY, method="POST", path="/extensions/101", body=raw, database="liwan_acme", timestamp=NOW)
        self.assertEqual(self.client.post("/registration", content=raw, headers=wrong_path_headers).status_code, 401)
        self.assertEqual(self.store.calls, [])

    def test_valid_signature_with_wrong_database_returns_403(self) -> None:
        # Wrong header database
        ans_header = signed_request(
            self.client,
            "POST",
            "/registration",
            payload={"extension": "101", "database": "liwan_acme"},
            database="liwan_other",
        )
        self.assertEqual(ans_header.status_code, 403)
        # Wrong body database (even when header matches)
        ans_body = signed_request(
            self.client,
            "POST",
            "/registration",
            payload={"extension": "101", "database": "liwan_other"},
            database="liwan_acme",
        )
        self.assertEqual(ans_body.status_code, 403)
        # Bodyless DELETE with wrong header database
        ans_del = signed_request(self.client, "DELETE", "/registration/101", database="liwan_other")
        self.assertEqual(ans_del.status_code, 403)
        self.assertEqual(self.store.calls, [])

    def test_extension_validation_enforced_everywhere(self) -> None:
        for bad_ext in ("1", "12345678901", "10-01", "abc", "١٠١"):
            encoded = quote(bad_ext, safe="")
            self.assertEqual(
                signed_request(self.client, "POST", "/registration", payload={"extension": bad_ext, "database": "liwan_acme"}).status_code,
                422,
            )
            self.assertEqual(
                signed_request(self.client, "DELETE", f"/registration/{encoded}").status_code,
                422,
            )
            self.assertEqual(
                signed_request(self.client, "PUT", f"/extensions/{encoded}", payload={"database": "liwan_acme", "active": True}).status_code,
                422,
            )
            self.assertEqual(
                signed_request(self.client, "DELETE", f"/extensions/{encoded}").status_code,
                422,
            )
        self.assertEqual(self.store.calls, [])

    def test_registration_rotates_with_overlap_and_returns_turn_rest_credentials(self) -> None:
        first = signed_request(self.client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"})
        self.assertEqual(first.status_code, 200, first.text)
        body1 = first.json()
        self.assertEqual(body1["ws_url"], "wss://acme.example.test/ws")
        self.assertEqual(body1["extension"], "101")
        self.assertRegex(body1["auth_username"], r"^101-[0-9a-f]{8}$")
        self.assertEqual(body1["expires_in_seconds"], 120)
        self.assertEqual(len(body1["ice_servers"]), 2)
        self.assertEqual(body1["ice_servers"][0], {"urls": "stun:stun.example.test:3478"})
        turn = body1["ice_servers"][1]
        self.assertEqual(turn["urls"], "turns:turn.example.test:5349")
        self.assertEqual(turn["username"], f"{NOW + 300}:101")
        expected_cred = base64.b64encode(
            hmac.new(TURN_SECRET.encode("utf-8"), f"{NOW + 300}:101".encode(), hashlib.sha1).digest()
        ).decode("ascii")
        self.assertEqual(turn["credential"], expected_cred)

        # Second registration 10s later keeps both auths during overlap window.
        self.now = float(NOW + 10)
        second = signed_request(
            self.client,
            "POST",
            "/registration",
            payload={"extension": "101", "database": "liwan_acme"},
            timestamp=NOW + 10,
        )
        self.assertEqual(second.status_code, 200, second.text)
        body2 = second.json()
        self.assertNotEqual(body1["password"], body2["password"])
        self.assertNotEqual(body1["auth_username"], body2["auth_username"])
        id1 = body1["auth_username"].replace("-", "_")
        id2 = body2["auth_username"].replace("-", "_")
        self.assertEqual(self.store.endpoints["101"]["auth"], f"{id2},{id1}")
        self.assertEqual(self.store.endpoints["101"]["from_domain"], "acme.example.test")
        self.assertEqual(self.store.endpoints["101"]["callerid"], "Extension 101 <101>")
        # No ARI dynamic config writes were sent.
        self.assertEqual(self.ari.requests, [])

    def test_pbx_db_failure_returns_502_without_password(self) -> None:
        failing_store = FakePbxStore(fail_on={"upsert_extension_session", "delete_extension"})
        app = create_app(self.settings, AriClient(self.ari), pbx_store=failing_store, clock=lambda: self.now)
        with TestClient(app) as failing_client:
            answer = signed_request(failing_client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"})
            self.assertEqual(answer.status_code, 502)
            self.assertNotIn("password", answer.text)
            self.assertEqual(signed_request(failing_client, "DELETE", "/registration/101").status_code, 502)
            self.assertEqual(
                signed_request(failing_client, "PUT", "/extensions/101", payload={"database": "liwan_acme", "active": False}).status_code,
                502,
            )
            self.assertEqual(signed_request(failing_client, "DELETE", "/extensions/101").status_code, 502)
        self.assertEqual(failing_store.auths, {})
        self.assertEqual(failing_store.endpoints, {})

    def test_delete_registration_revokes_all_sessions_and_is_idempotent(self) -> None:
        reg1 = signed_request(self.client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"}).json()
        reg2 = signed_request(self.client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"}).json()
        id1 = reg1["auth_username"].replace("-", "_")
        id2 = reg2["auth_username"].replace("-", "_")
        self.store.calls.clear()

        revoked = signed_request(self.client, "DELETE", "/registration/101")
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertEqual(revoked.json(), {"revoked": True, "extension": "101"})
        self.assertEqual(
            self.store.calls,
            [("delete_extension", {"extension": "101", "auth_ids": [id2, id1]})],
        )
        self.assertEqual(self.store.endpoints, {})
        self.assertEqual(self.store.aors, {})
        self.assertEqual(self.store.auths, {})

        # Idempotent when repeated on an already-deleted extension.
        self.store.calls.clear()
        again = signed_request(self.client, "DELETE", "/registration/101")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json(), {"revoked": True, "extension": "101"})
        self.assertEqual(self.store.calls, [("delete_extension", {"extension": "101", "auth_ids": []})])

    def test_put_and_delete_extensions_lifecycle(self) -> None:
        # PUT active=true validates without writing any open password to pbx-db.
        enabled = signed_request(self.client, "PUT", "/extensions/101", payload={"database": "liwan_acme", "active": True})
        self.assertEqual(enabled.status_code, 200, enabled.text)
        self.assertEqual(enabled.json(), {"extension": "101", "active": True})
        self.assertEqual(self.store.calls, [])

        # Issue a session, then PUT active=false disables and deletes PJSIP rows.
        reg = signed_request(self.client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"}).json()
        auth_id = reg["auth_username"].replace("-", "_")
        self.store.calls.clear()

        disabled = signed_request(self.client, "PUT", "/extensions/101", payload={"database": "liwan_acme", "active": False})
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertEqual(disabled.json(), {"extension": "101", "active": False})
        self.assertEqual(self.store.calls, [("delete_extension", {"extension": "101", "auth_ids": [auth_id]})])
        self.assertEqual(self.store.endpoints, {})

        # DELETE /extensions/101 disables and returns {"disabled": true, "extension": "101"}.
        reg2 = signed_request(self.client, "POST", "/registration", payload={"extension": "101", "database": "liwan_acme"}).json()
        auth_id2 = reg2["auth_username"].replace("-", "_")
        self.store.calls.clear()

        deleted = signed_request(self.client, "DELETE", "/extensions/101")
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json(), {"disabled": True, "extension": "101"})
        self.assertEqual(self.store.calls, [("delete_extension", {"extension": "101", "auth_ids": [auth_id2]})])
        self.assertEqual(self.store.endpoints, {})

    def test_recordings_link_clock_tolerance_and_expiry_capping(self) -> None:
        (self.settings.recordings_dir / "1764049999.1.wav").write_bytes(b"RIFFdemo")

        # Expired (<= now) -> 410
        expired = signed_request(
            self.client,
            "POST",
            "/recordings/link",
            payload={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": NOW},
        )
        self.assertEqual(expired.status_code, 410)

        # Too far in the future (> now + 60 + 300) -> 422
        too_far = signed_request(
            self.client,
            "POST",
            "/recordings/link",
            payload={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": NOW + 361},
        )
        self.assertEqual(too_far.status_code, 422)

        # Missing recording -> 404
        missing = signed_request(
            self.client,
            "POST",
            "/recordings/link",
            payload={"linkedid": "1764049999.999", "database": "liwan_acme", "expires_at": NOW + 60},
        )
        self.assertEqual(missing.status_code, 404)

        # Within +300s clock skew: accepted, and minted token expiry capped at now + 60.
        skewed = signed_request(
            self.client,
            "POST",
            "/recordings/link",
            payload={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": NOW + 250},
        )
        self.assertEqual(skewed.status_code, 200, skewed.text)
        data = skewed.json()
        self.assertEqual(data["expiresInSeconds"], 60)
        token = data["url"].rsplit("/", 1)[-1]
        token_payload = verify_recording_token(KEY, token, host="acme.example.test", now=NOW)
        self.assertIsNotNone(token_payload)
        self.assertEqual(token_payload["exp"], NOW + 60)

        # Shorter requested lifetime (< 60s) is respected.
        short = signed_request(
            self.client,
            "POST",
            "/recordings/link",
            payload={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": NOW + 25},
        )
        self.assertEqual(short.status_code, 200, short.text)
        self.assertEqual(short.json()["expiresInSeconds"], 25)

    def test_health_probes_ari_and_reports_session_reaper_worker(self) -> None:
        booted = FakeAri({("GET", "/asterisk/info"): (200, {"status": "fully booted"})})
        with TestClient(create_app(self.settings, AriClient(booted), pbx_store=FakePbxStore(), clock=lambda: self.now)) as client:
            report = client.get("/health").json()
        self.assertEqual(report["ari"], {"reachable": True, "connected": False})
        self.assertEqual(report["status"], "degraded")
        self.assertIn("sessions", report["workers"])
        self.assertIn(EVENT_TIMESTAMP_HEADER, reverse_headers(KEY, method="GET", path="/x", body=b"", database="liwan_acme", timestamp=NOW))
        self.assertEqual(booted.requests, [AriRequest("GET", "/asterisk/info", None, None)])
        silent = FakeAri()
        with TestClient(create_app(self.settings, AriClient(silent), pbx_store=FakePbxStore())) as client:
            self.assertFalse(client.get("/health").json()["ari"]["reachable"])
        self.assertEqual(silent.requests, [AriRequest("GET", "/asterisk/info", None, None)])


if __name__ == "__main__":
    unittest.main()
