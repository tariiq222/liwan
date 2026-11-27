from __future__ import annotations

import base64
import hashlib
import hmac
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from fakes import FakePbxStore

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.pbx_db import PbxStoreError  # noqa: E402
from pbx_agent.sessions import SessionManager  # noqa: E402
from pbx_agent.settings import Settings  # noqa: E402

TURN_SECRET = "s" * 32


def make_settings(
    tmp: Path,
    *,
    session_seconds: int = 120,
    session_overlap_seconds: int = 30,
    stun_url: str | None = "stun:stun.example.test:3478",
    turn_url: str | None = "turns:turn.example.test:5349",
    turn_secret: str | None = TURN_SECRET,
) -> Settings:
    recordings = tmp / "monitor"
    recordings.mkdir(exist_ok=True)
    return Settings(
        ari_url="http://ari.test:8088/ari",
        ari_username="liwan",
        ari_password="secret",
        pbx_db_url="postgresql://pbx:secret@pbx-db:5432/telephony_pbx",
        database="liwan_acme",
        events_key=bytes.fromhex("ab" * 32),
        reverse_key=bytes.fromhex("cd" * 32),
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
        stun_url=stun_url,
        turn_url=turn_url,
        turn_secret=turn_secret,
        session_seconds=session_seconds,
        session_overlap_seconds=session_overlap_seconds,
        pjsip_transport="transport-ws",
        pjsip_context="from-extension",
    )


class SessionManagerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_issue_writes_unique_slot_to_pbx_db_and_mints_turn_rest_credentials(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root), store)
        self.addCleanup(manager.close)

        issued = manager.issue("101", now=1700000000.0)
        self.assertEqual(issued.ws_url, "wss://acme.example.test/ws")
        self.assertEqual(issued.extension, "101")
        self.assertRegex(issued.auth_username, r"^101-[0-9a-f]{8}$")
        self.assertEqual(issued.expires_in_seconds, 120)

        slot = issued.auth_username.split("-")[1]
        auth_id = f"101_{slot}"
        self.assertEqual([op for op, _ in store.calls], ["upsert_extension_session"])
        self.assertEqual(
            store.auths[auth_id],
            {"auth_type": "userpass", "username": issued.auth_username, "password": issued.password},
        )
        self.assertEqual(
            store.aors["101"],
            {"max_contacts": 1, "remove_existing": "yes", "default_expiration": 120, "maximum_expiration": 120},
        )
        self.assertEqual(store.endpoints["101"]["auth"], auth_id)
        self.assertEqual(store.endpoints["101"]["from_domain"], "acme.example.test")
        self.assertEqual(store.endpoints["101"]["callerid"], "Extension 101 <101>")

        # ICE servers: STUN + TURN REST HMAC-SHA1
        self.assertEqual(len(issued.ice_servers), 2)
        self.assertEqual(issued.ice_servers[0], {"urls": "stun:stun.example.test:3478"})
        turn = issued.ice_servers[1]
        self.assertEqual(turn["urls"], "turns:turn.example.test:5349")
        self.assertEqual(turn["username"], "1700000300:101")
        expected_cred = base64.b64encode(
            hmac.new(TURN_SECRET.encode("utf-8"), b"1700000300:101", hashlib.sha1).digest()
        ).decode("ascii")
        self.assertEqual(turn["credential"], expected_cred)

    def test_rotation_keeps_immediately_preceding_live_auth_for_overlap_and_drops_older(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root, session_seconds=120, session_overlap_seconds=30), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")

        # Second issue at t=1050: first_id expires_at shrinks from 1120 to min(1120, 1050 + 30) = 1080.
        second = manager.issue("101", now=1050.0)
        second_id = second.auth_username.replace("-", "_")
        self.assertEqual(store.endpoints["101"]["auth"], f"{second_id},{first_id}")
        rows = {r["auth_id"]: r["expires_at"] for r in manager.active_sessions("101")}
        self.assertEqual(rows, {second_id: 1170.0, first_id: 1080.0})

        # Third issue at t=1060: keeps second_id (min(1170, 1090)=1090), drops first_id atomically.
        store.calls.clear()
        third = manager.issue("101", now=1060.0)
        third_id = third.auth_username.replace("-", "_")
        self.assertEqual(len(store.calls), 1)
        op, payload = store.calls[0]
        self.assertEqual(op, "upsert_extension_session")
        self.assertEqual(payload["auth_ids"], [third_id, second_id])
        self.assertEqual(payload["drop_auth_ids"], [first_id])
        self.assertNotIn(first_id, store.auths)
        self.assertEqual(store.endpoints["101"]["auth"], f"{third_id},{second_id}")
        rows = {r["auth_id"]: r["expires_at"] for r in manager.active_sessions("101")}
        self.assertEqual(rows, {third_id: 1180.0, second_id: 1090.0})

    def test_rotation_never_extends_previous_auth_past_its_original_expiry(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root, session_seconds=120, session_overlap_seconds=30), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)  # expires at 1120
        first_id = first.auth_username.replace("-", "_")
        second = manager.issue("101", now=1110.0)  # now + 30 = 1140 > 1120, must cap at 1120
        second_id = second.auth_username.replace("-", "_")

        rows = {r["auth_id"]: r["expires_at"] for r in manager.active_sessions("101")}
        self.assertEqual(rows, {second_id: 1230.0, first_id: 1120.0})

    def test_zero_overlap_drops_previous_auth_immediately(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root, session_seconds=60, session_overlap_seconds=0), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")
        store.calls.clear()

        second = manager.issue("101", now=1010.0)
        second_id = second.auth_username.replace("-", "_")
        self.assertEqual(store.endpoints["101"]["auth"], second_id)
        self.assertNotIn(first_id, store.auths)
        self.assertEqual([r["auth_id"] for r in manager.active_sessions("101")], [second_id])

    def test_db_failure_leaves_sqlite_and_existing_pbx_rows_untouched(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")

        store.calls.clear()
        store.fail_on.add("upsert_extension_session")
        with self.assertRaises(PbxStoreError):
            manager.issue("101", now=1020.0)

        self.assertEqual(list(store.auths), [first_id])
        self.assertEqual(store.endpoints["101"]["auth"], first_id)
        self.assertEqual(
            [(r["auth_id"], r["expires_at"]) for r in manager.active_sessions("101")],
            [(first_id, 1120.0)],
        )

    def test_new_extension_db_failure_leaves_sqlite_empty(self) -> None:
        store = FakePbxStore(fail_on={"upsert_extension_session"})
        manager = SessionManager(make_settings(self.root), store)
        self.addCleanup(manager.close)

        with self.assertRaises(PbxStoreError):
            manager.issue("101", now=1000.0)

        self.assertEqual(store.auths, {})
        self.assertEqual(store.endpoints, {})
        self.assertEqual(manager.active_sessions("101"), [])

    def test_reaper_updates_endpoint_on_overlap_expiry_and_deletes_extension_on_last_expiry(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root, session_seconds=120, session_overlap_seconds=30), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")
        second = manager.issue("101", now=1050.0)  # first expires at 1080, second at 1170
        second_id = second.auth_username.replace("-", "_")

        # Before overlap expires: reaper does nothing.
        store.calls.clear()
        self.assertEqual(manager.reap(now=1079.0), 0)
        self.assertEqual(store.calls, [])

        # At t=1080: first_id expires while second_id is live -> atomic update_endpoint_auths.
        self.assertEqual(manager.reap(now=1080.0), 1)
        self.assertEqual(
            store.calls,
            [("update_endpoint_auths", {"extension": "101", "auth_ids": [second_id], "drop_auth_ids": [first_id]})],
        )
        self.assertEqual(store.endpoints["101"]["auth"], second_id)
        self.assertNotIn(first_id, store.auths)
        self.assertEqual([r["auth_id"] for r in manager.active_sessions("101")], [second_id])

        # At t=1170: second_id expires, zero live sessions left -> atomic delete_extension.
        store.calls.clear()
        self.assertEqual(manager.reap(now=1170.0), 1)
        self.assertEqual(store.calls, [("delete_extension", {"extension": "101", "auth_ids": [second_id]})])
        self.assertNotIn("101", store.endpoints)
        self.assertNotIn("101", store.aors)
        self.assertEqual(store.auths, {})
        self.assertEqual(manager.active_sessions("101"), [])

    def test_reaper_defers_sqlite_cleanup_when_pbx_db_write_fails(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root, session_seconds=60, session_overlap_seconds=0), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")

        store.fail_on.add("delete_extension")
        self.assertEqual(manager.reap(now=1060.0), 0)
        self.assertEqual([r["auth_id"] for r in manager.active_sessions("101")], [first_id])

        store.fail_on.clear()
        self.assertEqual(manager.reap(now=1060.0), 1)
        self.assertEqual(manager.active_sessions("101"), [])

    def test_revoke_deletes_extension_and_orphans_and_is_idempotent(self) -> None:
        store = FakePbxStore()
        manager = SessionManager(make_settings(self.root), store)
        self.addCleanup(manager.close)

        first = manager.issue("101", now=1000.0)
        second = manager.issue("101", now=1020.0)
        first_id = first.auth_username.replace("-", "_")
        second_id = second.auth_username.replace("-", "_")
        store.auths["101_orphan99"] = {"auth_type": "userpass", "username": "101-orphan99", "password": "old"}

        store.calls.clear()
        manager.revoke("101")
        self.assertEqual(
            store.calls,
            [("delete_extension", {"extension": "101", "auth_ids": [second_id, first_id]})],
        )
        self.assertEqual(store.endpoints, {})
        self.assertEqual(store.aors, {})
        self.assertEqual(store.auths, {})
        self.assertEqual(manager.active_sessions("101"), [])

        # Repeating revoke when no SQLite rows exist still runs delete_extension idempotently.
        store.calls.clear()
        manager.revoke("101")
        self.assertEqual(store.calls, [("delete_extension", {"extension": "101", "auth_ids": []})])

    def test_sessions_persist_across_restart_and_concurrent_issues_serialize(self) -> None:
        cfg = make_settings(self.root)
        store = FakePbxStore()
        m1 = SessionManager(cfg, store)
        first = m1.issue("101", now=1000.0)
        first_id = first.auth_username.replace("-", "_")
        m1.close()

        m2 = SessionManager(cfg, store)
        self.addCleanup(m2.close)
        self.assertEqual([r["auth_id"] for r in m2.active_sessions("101")], [first_id])

        errors: list[Exception] = []

        def worker() -> None:
            try:
                m2.issue("101", now=1010.0)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        # At most 2 active rows (newest + 1 overlap) remain in SQLite.
        self.assertLessEqual(len(m2.active_sessions("101")), 2)


if __name__ == "__main__":
    unittest.main()
