"""The two routes Odoo calls: the session mint and the recording link (design 4.1, 4.4, 12.6).

Both are refused without the company's reverse key, and the session mint writes the endpoint before answering, so a
browser that receives a password always has an endpoint that accepts it. The Asterisk the route writes to is the
recorded fake, so what the test checks is what the route put on the wire. ``GET /health`` probes that same client.
"""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

from fakes import AriRequest, FakeAri
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.app import create_app  # noqa: E402
from pbx_agent.ari import AriClient  # noqa: E402
from pbx_agent.settings import Settings  # noqa: E402

KEY = bytes.fromhex("cd" * 32)
OTHER = bytes.fromhex("ef" * 32)
AUTH = "/asterisk/config/dynamic/res_pjsip/auth/101"
AOR = "/asterisk/config/dynamic/res_pjsip/aor/101"
ENDPOINT = "/asterisk/config/dynamic/res_pjsip/endpoint/101"


def settings(tmp) -> Settings:
    recordings = tmp / "monitor"
    recordings.mkdir()
    return Settings(
        ari_url="http://ari.test:8088/ari",
        ari_username="liwan",
        ari_password="secret",
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
        ice_servers=[{"urls": "stun:turn.example.test:3478"}],
        session_seconds=60,
        pjsip_transport="transport-ws",
        pjsip_context="from-extension",
    )


def registration(client: TestClient, extension: str = "101", database: str = "liwan_acme", key: str = KEY.hex()):
    return client.post("/registration", json={"extension": extension, "database": database}, headers={"X-Liwan-Key": key})


def attributes(request) -> dict:
    """The realtime object the route wrote, as ``attribute: value``."""
    return {field["attribute"]: field["value"] for field in request.body["fields"]}


class RoutesTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.settings = settings(self.root)
        self.ari = FakeAri()
        self.client = TestClient(create_app(self.settings, AriClient(self.ari)))

    def test_registration_without_the_key_is_refused(self):
        answer = self.client.post("/registration", json={"extension": "101", "database": "liwan_acme"})
        self.assertEqual(answer.status_code, 401)
        self.assertEqual(self.ari.requests, [])

    def test_registration_with_another_company_key_is_refused(self):
        answer = registration(self.client, key=OTHER.hex())
        self.assertEqual(answer.status_code, 401)
        self.assertEqual(self.ari.requests, [])

    def test_registration_refuses_another_database(self):
        answer = registration(self.client, database="liwan_other")
        self.assertEqual(answer.status_code, 403)
        self.assertEqual(self.ari.requests, [])

    def test_a_link_for_a_missing_recording_is_404(self):
        answer = self.client.post(
            "/recordings/link",
            json={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": int(time.time()) + 60},
            headers={"X-Liwan-Key": KEY.hex()},
        )
        self.assertEqual(answer.status_code, 404)

    def test_an_expired_request_is_refused(self):
        answer = self.client.post(
            "/recordings/link",
            json={"linkedid": "1764049999.1", "database": "liwan_acme", "expires_at": int(time.time()) - 1},
            headers={"X-Liwan-Key": KEY.hex()},
        )
        self.assertEqual(answer.status_code, 410)

    def test_a_valid_registration_answers_the_url_and_a_fresh_password_written_to_the_endpoint(self):
        """Two registrations never share a password, and each answer's password is the one written for its endpoint."""
        first, second = registration(self.client), registration(self.client)
        for answer in (first, second):
            self.assertEqual(answer.status_code, 200, answer.text)
            body = answer.json()
            self.assertEqual(body["ws_url"], "wss://acme.example.test/ws")
            self.assertEqual(body["extension"], "101")
            self.assertEqual(len(body["ice_servers"]), 1)
        self.assertNotEqual(first.json()["password"], second.json()["password"])
        written = [attributes(request)["password"] for request in self.ari.requests if request.path == AUTH]
        self.assertEqual(written, [first.json()["password"], second.json()["password"]])

    def test_the_endpoint_is_written_before_the_answer_with_the_package_settings(self):
        answer = registration(self.client)
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(
            [(request.method, request.path) for request in self.ari.requests],
            [("PUT", AUTH), ("PUT", AOR), ("PUT", ENDPOINT)],
        )
        endpoint = attributes(self.ari.requests[2])
        self.assertEqual(endpoint["aors"], "101")
        self.assertEqual(endpoint["auth"], "101")
        self.assertEqual(endpoint["transport"], "transport-ws")
        self.assertEqual(endpoint["context"], "from-extension")
        self.assertEqual(attributes(self.ari.requests[0])["username"], "101")

    def test_a_registration_whose_endpoint_write_fails_answers_502_and_no_password(self):
        failing = TestClient(create_app(self.settings, AriClient(FakeAri({("PUT", AOR): (500, None)}))))
        answer = registration(failing)
        self.assertEqual(answer.status_code, 502)
        self.assertNotIn("password", answer.text)

    def test_health_asks_the_injected_client_whether_ari_answers(self):
        """``/health`` probes the injected client: a scripted Asterisk is reachable, a silent one is not."""
        booted = FakeAri({("GET", "/asterisk/info"): (200, {"status": "fully booted"})})
        report = TestClient(create_app(self.settings, AriClient(booted))).get("/health").json()
        self.assertEqual(report["ari"], {"reachable": True, "connected": False})
        self.assertEqual(report["status"], "degraded")  # no event stream runs without the app's lifespan
        self.assertEqual(booted.requests, [AriRequest("GET", "/asterisk/info", None, None)])
        silent = FakeAri()
        self.assertFalse(TestClient(create_app(self.settings, AriClient(silent))).get("/health").json()["ari"]["reachable"])
        self.assertEqual(silent.requests, [AriRequest("GET", "/asterisk/info", None, None)])


if __name__ == "__main__":
    unittest.main()
