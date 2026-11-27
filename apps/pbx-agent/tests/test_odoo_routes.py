"""The two routes Odoo calls: the session mint and the recording link (design 4.1, 4.4, 12.6).

Both are refused without the company's reverse key, and the session mint writes the endpoint before answering, so a
browser that receives a password always has an endpoint that accepts it.
"""

from __future__ import annotations

import time
import unittest

from fastapi.testclient import TestClient

from pbx_agent.app import create_app
from pbx_agent.settings import Settings

KEY = bytes.fromhex("cd" * 32)
OTHER = bytes.fromhex("ef" * 32)


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
    )


class RoutesTest(unittest.TestCase):

    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        from pathlib import Path

        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.app = create_app(settings(self.root))
        self.client = TestClient(self.app)

    def test_registration_without_the_key_is_refused(self):
        answer = self.client.post("/registration", json={"extension": "101", "database": "liwan_acme"})
        self.assertEqual(answer.status_code, 401)

    def test_registration_with_another_company_key_is_refused(self):
        answer = self.client.post(
            "/registration",
            json={"extension": "101", "database": "liwan_acme"},
            headers={"X-Liwan-Key": OTHER.hex()},
        )
        self.assertEqual(answer.status_code, 401)

    def test_registration_refuses_another_database(self):
        answer = self.client.post(
            "/registration",
            json={"extension": "101", "database": "liwan_other"},
            headers={"X-Liwan-Key": KEY.hex()},
        )
        self.assertEqual(answer.status_code, 403)

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

    def test_a_valid_registration_answers_with_the_ws_url_and_a_fresh_password(self):
        """Two registrations never share a password, and the answer names the browser's own endpoint.

        The endpoint write is the one call that needs a live Asterisk; it is stubbed so the route's own contract (the
        key, the database, a fresh password, the URL) is what the test proves.
        """
        from unittest import mock

        answers = []
        with mock.patch('pbx_agent.ari.AriClient.upsert_endpoint', lambda *args, **kwargs: None):
            for _ in range(2):
                answers.append(self.client.post(
                    '/registration',
                    json={'extension': '101', 'database': 'liwan_acme'},
                    headers={'X-Liwan-Key': KEY.hex()},
                ))
        first, second = answers
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['ws_url'], 'wss://acme.example.test/ws')
        self.assertEqual(first.json()['extension'], '101')
        self.assertTrue(first.json()['password'])
        self.assertNotEqual(first.json()['password'], second.json()['password'])
        self.assertEqual(len(first.json()['ice_servers']), 1)
