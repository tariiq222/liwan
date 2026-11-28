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
import logging
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
from pbx_agent.ingest import LIVE_LEG_WINDOW_SECONDS, AriIngest  # noqa: E402
from pbx_agent.queue import EventQueue  # noqa: E402
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


def channel_event(kind: str, linkedid: str) -> dict:
    """One ARI channel event of a call: the channel's own id, and the call's linkedid."""
    return {
        "type": kind,
        "timestamp": "2026-11-25T09:01:00.000+0000",
        "channel": {
            "id": f"{linkedid}.1",
            "linkedid": linkedid,
            "name": f"PJSIP/{linkedid}.1",
            "state": "Up",
            "caller": {"number": "+966500000000"},
            "connected": {"number": "1001"},
            "dialplan": {"context": "from-trunk", "exten": "1001"},
        },
    }


class RecordingRoutesTest(unittest.TestCase):
    """The recording policy push and the recording deletion Odoo calls (design 4.4)."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch("pbx_agent.app.AriListener.run_forever", side_effect=lambda stop: stop.wait())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.root = Path(self.tmp.name)
        self.now = float(NOW)
        self.settings = make_settings(self.root)
        self.store = FakePbxStore()
        ingest_queue = EventQueue(self.root / "ingest.sqlite3")
        self.addCleanup(ingest_queue.close)
        self.ingest = AriIngest(
            ingest_queue,
            database="liwan_acme",
            inbound_context="from-trunk",
            recordings_dir=self.settings.recordings_dir,
            clock=lambda: self.now,
        )
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        app = create_app(self.settings, AriClient(FakeAri()), pbx_store=self.store, ingest=self.ingest, clock=lambda: self.now)
        self.client = stack.enter_context(TestClient(app))

    def recording(self, linkedid: str) -> Path:
        path = self.settings.recordings_dir / f"{linkedid}.wav"
        path.write_bytes(b"RIFF")
        return path

    def config(self, **overrides) -> dict:
        payload = {"database": "liwan_acme", "policy": "always", "announce": True, **overrides}
        return signed_request(self.client, "PUT", "/recording/config", payload=payload)

    def delete(self, linkedids, **kwargs):
        payload = {"database": "liwan_acme", "linkedids": list(linkedids)}
        return signed_request(self.client, "POST", "/recordings/delete", payload=payload, **kwargs)

    def raw_request(self, method: str, path: str, payload: dict, *, signed_method: str | None = None, signed_path: str | None = None):
        """Send a body signed as if it were another method or path, keeping the sent method and path."""
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = reverse_headers(
            KEY,
            method=signed_method or method,
            path=signed_path or path,
            body=raw,
            database="liwan_acme",
            timestamp=NOW,
        )
        headers["Content-Type"] = "application/json"
        return self.client.request(method, path, content=raw, headers=headers)

    def test_config_route_requires_a_reverse_signed_request(self) -> None:
        payload = {"database": "liwan_acme", "policy": "always", "announce": True}
        self.assertEqual(self.client.put("/recording/config", json=payload).status_code, 401)
        self.assertEqual(self.config().status_code, 200)
        self.assertEqual(signed_request(self.client, "PUT", "/recording/config", payload=payload, key=OTHER).status_code, 401)
        self.assertEqual(signed_request(self.client, "PUT", "/recording/config", payload=payload, timestamp=NOW - 301).status_code, 401)
        self.assertEqual(signed_request(self.client, "PUT", "/recording/config", payload=payload, timestamp=NOW + 301).status_code, 401)
        # The method and the path are inside the signature: a body signed as a POST or for another route is refused.
        self.assertEqual(self.raw_request("PUT", "/recording/config", payload, signed_method="POST").status_code, 401)
        self.assertEqual(self.raw_request("PUT", "/recording/config", payload, signed_path="/recordings/link").status_code, 401)

    def test_config_route_refuses_another_company_database(self) -> None:
        payload = {"database": "liwan_acme", "policy": "always", "announce": True}
        self.assertEqual(signed_request(self.client, "PUT", "/recording/config", payload=payload, database="liwan_other").status_code, 403)
        self.assertEqual(
            signed_request(self.client, "PUT", "/recording/config", payload={**payload, "database": "liwan_other"}).status_code,
            403,
        )
        self.assertEqual(self.store.calls, [])

    def test_config_body_is_strict(self) -> None:
        self.assertEqual(self.config(extra="x").status_code, 422)
        self.assertEqual(self.config(policy="sometimes").status_code, 422)
        self.assertEqual(self.config(policy=None).status_code, 422)
        self.assertEqual(self.config(announce="yes").status_code, 422)
        self.assertEqual(self.config(announce=1).status_code, 422)
        # A database that is not this company's answers 403 like every other route; a non-string is a schema error.
        self.assertEqual(self.config(database="").status_code, 403)
        self.assertEqual(self.config(database=None).status_code, 422)
        self.assertEqual(self.store.calls, [])

    def test_config_upsert_twice_keeps_the_single_row(self) -> None:
        first = self.config()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), {"applied": True})
        second = self.config(policy="off", announce=False)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(second.json(), {"applied": True})
        self.assertEqual(self.store.recording_config, {1: {"policy": "off", "announce": False}})
        self.assertEqual([name for name, _ in self.store.calls], ["upsert_recording_config", "upsert_recording_config"])

    def test_config_write_failure_answers_502_without_claiming_it_applied(self) -> None:
        store = FakePbxStore(fail_on={"upsert_recording_config"})
        app = create_app(self.settings, AriClient(FakeAri()), pbx_store=store, ingest=self.ingest, clock=lambda: self.now)
        with TestClient(app) as client:
            payload = {"database": "liwan_acme", "policy": "always", "announce": True}
            answer = signed_request(client, "PUT", "/recording/config", payload=payload)
            self.assertEqual(answer.status_code, 502)
            self.assertNotIn("applied", answer.text)

    def test_delete_route_requires_a_reverse_signed_request_and_the_company_database(self) -> None:
        payload = {"database": "liwan_acme", "linkedids": ["1764049999.1"]}
        self.assertEqual(self.client.post("/recordings/delete", json=payload).status_code, 401)
        self.assertEqual(signed_request(self.client, "POST", "/recordings/delete", payload=payload, key=OTHER).status_code, 401)
        self.assertEqual(signed_request(self.client, "POST", "/recordings/delete", payload=payload, timestamp=NOW - 301).status_code, 401)
        # Signed as the other recordings route: the path is inside the signature.
        self.assertEqual(self.raw_request("POST", "/recordings/delete", payload, signed_path="/recordings/link").status_code, 401)
        self.assertEqual(signed_request(self.client, "POST", "/recordings/delete", payload=payload, database="liwan_other").status_code, 403)
        self.assertEqual(
            signed_request(self.client, "POST", "/recordings/delete", payload={**payload, "database": "liwan_other"}).status_code,
            403,
        )

    def test_delete_body_is_strict_and_capped(self) -> None:
        self.assertEqual(self.delete([]).status_code, 422)
        self.assertEqual(self.delete(["1764049999.1"] * 501).status_code, 422)
        extra_key = {"database": "liwan_acme", "linkedids": ["1764049999.1"], "extra": "x"}
        self.assertEqual(self.raw_request("POST", "/recordings/delete", extra_key).status_code, 422)
        self.assertEqual(self.delete([123]).status_code, 422)
        self.assertEqual(self.store.calls, [])

    def test_delete_removes_the_file_it_reports_and_a_second_call_reports_it_missing(self) -> None:
        first = self.recording("1764049999.1")
        second = self.recording("1764049999.2")
        with self.assertLogs("pbx_agent.odoo_routes", level=logging.INFO) as logs:
            answer = self.delete(["1764049999.1", "1764049999.2", "1764049999.3", "1764049999.1"])
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(answer.json(), {"deleted": ["1764049999.1", "1764049999.2"], "missing": ["1764049999.3"]})
        self.assertFalse(first.exists())
        self.assertFalse(second.exists())
        # One line per deletion, carrying the call id.
        deleted_lines = [line for line in logs.output if "1764049999.1" in line or "1764049999.2" in line]
        self.assertEqual(len(deleted_lines), 2, logs.output)
        repeat = self.delete(["1764049999.1", "1764049999.2", "1764049999.3"])
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(repeat.json(), {"deleted": [], "missing": ["1764049999.1", "1764049999.2", "1764049999.3"]})

    def test_delete_skips_a_live_call_and_keeps_its_file(self) -> None:
        file = self.recording("1764049999.1")
        self.ingest.handle(channel_event("ChannelCreated", "1764049999.1"), now=self.now)
        with self.assertLogs("pbx_agent.odoo_routes", level=logging.INFO) as logs:
            answer = self.delete(["1764049999.1"])
        self.assertEqual(answer.status_code, 200, answer.text)
        # Neither deleted nor missing: Odoo must leave the recording available.
        self.assertEqual(answer.json(), {"deleted": [], "missing": []})
        self.assertTrue(file.exists())
        self.assertEqual(len([line for line in logs.output if "1764049999.1" in line]), 1, logs.output)
        # Once the call has no leg left, the next request deletes the file.
        self.ingest.handle(channel_event("ChannelDestroyed", "1764049999.1"), now=self.now)
        self.assertEqual(self.delete(["1764049999.1"]).json(), {"deleted": ["1764049999.1"], "missing": []})
        self.assertFalse(file.exists())

    def test_delete_removes_the_recording_of_a_call_whose_leg_went_stale(self) -> None:
        """A leg whose end event was lost must not pin the recording forever; past the window the call is dead."""
        file = self.recording("1764049999.1")
        self.ingest.handle(channel_event("ChannelCreated", "1764049999.1"), now=self.now)
        self.assertEqual(self.delete(["1764049999.1"]).json(), {"deleted": [], "missing": []})
        self.now += LIVE_LEG_WINDOW_SECONDS
        answer = self.delete(["1764049999.1"], timestamp=int(self.now))
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(answer.json(), {"deleted": ["1764049999.1"], "missing": []})
        self.assertFalse(file.exists())

    def test_delete_refuses_a_name_outside_the_call_id_rule(self) -> None:
        outside = self.settings.recordings_dir.parent / "secret.wav"
        outside.write_bytes(b"secret")
        for call_id in ("../secret", "../../etc/passwd", "/etc/passwd", "a/b", "a\\b", "", ".", ".."):
            self.assertEqual(self.delete([call_id]).status_code, 422, call_id)
        self.assertTrue(outside.exists())
        self.assertEqual(list(self.settings.recordings_dir.iterdir()), [])

    def test_delete_reports_a_missing_file_without_an_error(self) -> None:
        answer = self.delete(["1764049999.1"])
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(answer.json(), {"deleted": [], "missing": ["1764049999.1"]})


if __name__ == "__main__":
    unittest.main()
