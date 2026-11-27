from __future__ import annotations

import logging
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.pbx_db import (  # noqa: E402
    DELETE_AOR_SQL,
    DELETE_AUTH_SQL,
    DELETE_ENDPOINT_SQL,
    DELETE_ORPHAN_AUTHS_SQL,
    UPDATE_ENDPOINT_AUTH_SQL,
    UPSERT_AOR_SQL,
    UPSERT_AUTH_SQL,
    UPSERT_ENDPOINT_SQL,
    PbxStoreError,
    PostgresPbxStore,
    _escape_like_prefix,
)

SECRET_PASSWORD = "db-super-secret-password-98765"
TEST_DSN = f"postgresql://pbx:{SECRET_PASSWORD}@pbx-db:5432/telephony_pbx"


class FakeTransaction:
    def __init__(self, conn: FakeConnection) -> None:
        self._conn = conn

    def __enter__(self) -> FakeTransaction:
        self._conn.transactions_started += 1
        self._conn.in_transaction = True
        return self

    def __exit__(self, exc_type, _exc, _tb) -> None:
        self._conn.in_transaction = False
        if exc_type is None:
            self._conn.transactions_committed += 1
        else:
            self._conn.transactions_rolled_back += 1


class FakeConnection:
    def __init__(self, *, fail_on_execute: Exception | None = None) -> None:
        self.fail_on_execute = fail_on_execute
        self.statements: list[tuple[str, tuple]] = []
        self.transactions_started = 0
        self.transactions_committed = 0
        self.transactions_rolled_back = 0
        self.in_transaction = False
        self.closed = False

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_exc) -> None:
        self.closed = True

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self)

    def execute(self, sql: str, params: tuple = ()) -> None:
        assert self.in_transaction, "every write must execute inside conn.transaction()"
        if self.fail_on_execute is not None:
            raise self.fail_on_execute
        self.statements.append((sql, params))


class PostgresPbxStoreTest(unittest.TestCase):
    def test_repr_hides_dsn_and_password(self) -> None:
        store = PostgresPbxStore(TEST_DSN, connect_timeout=7)
        shown = repr(store)
        self.assertNotIn(SECRET_PASSWORD, shown)
        self.assertNotIn("pbx-db", shown)
        self.assertNotIn("postgresql://", shown)
        self.assertIn("connect_timeout=7", shown)

    def test_upsert_extension_session_runs_in_one_atomic_transaction(self) -> None:
        conn = FakeConnection()
        connect_calls: list[tuple[str, int]] = []

        def fake_connect(dsn: str, *, connect_timeout: int) -> FakeConnection:
            connect_calls.append((dsn, connect_timeout))
            return conn

        store = PostgresPbxStore(TEST_DSN, connect_timeout=6, connect=fake_connect)
        store.upsert_extension_session(
            extension="101",
            auth_id="101_a1b2c3d4",
            auth_username="101-a1b2c3d4",
            password="session-password",
            auth_ids=["101_a1b2c3d4", "101_00001111"],
            session_seconds=120,
            transport="transport-ws",
            context="from-extension",
            from_domain="acme.example.test",
            drop_auth_ids=["101_deadbeef"],
        )

        self.assertEqual(connect_calls, [(TEST_DSN, 6)])
        self.assertEqual(conn.transactions_started, 1)
        self.assertEqual(conn.transactions_committed, 1)
        self.assertEqual(conn.transactions_rolled_back, 0)
        self.assertTrue(conn.closed)
        self.assertEqual(
            conn.statements,
            [
                (UPSERT_AUTH_SQL, ("101_a1b2c3d4", "101-a1b2c3d4", "session-password")),
                (UPSERT_AOR_SQL, ("101", 120, 120)),
                (
                    UPSERT_ENDPOINT_SQL,
                    (
                        "101",
                        "transport-ws",
                        "101",
                        "101_a1b2c3d4,101_00001111",
                        "from-extension",
                        "acme.example.test",
                        "Extension 101 <101>",
                    ),
                ),
                (DELETE_AUTH_SQL, ("101_deadbeef",)),
            ],
        )

    def test_upsert_endpoint_sql_allows_g711_before_opus(self) -> None:
        # The pinned Asterisk image has no opus translator: an opus-first browser leg records an empty WAV and bridges
        # to the ulaw trunk without audio.
        columns, values = UPSERT_ENDPOINT_SQL.split(") VALUES (")
        columns = columns.split("ps_endpoints (", 1)[1].split(", ")
        values = values.split(")", 1)[0].split(", ")
        self.assertEqual("'ulaw,alaw,opus'", values[columns.index("allow")])

    def test_update_endpoint_auths_narrows_auth_and_drops_expired_in_one_transaction(self) -> None:
        conn = FakeConnection()
        store = PostgresPbxStore(TEST_DSN, connect=lambda _dsn, **_kw: conn)
        store.update_endpoint_auths(
            extension="101",
            auth_ids=["101_bbbb2222"],
            drop_auth_ids=["101_aaaa1111", "101_00000000"],
        )

        self.assertEqual(conn.transactions_started, 1)
        self.assertEqual(conn.transactions_committed, 1)
        self.assertTrue(conn.closed)
        self.assertEqual(
            conn.statements,
            [
                (UPDATE_ENDPOINT_AUTH_SQL, ("101_bbbb2222", "101")),
                (DELETE_AUTH_SQL, ("101_aaaa1111",)),
                (DELETE_AUTH_SQL, ("101_00000000",)),
            ],
        )

    def test_delete_extension_removes_endpoint_aor_known_auths_and_orphans_in_one_transaction(self) -> None:
        conn = FakeConnection()
        store = PostgresPbxStore(TEST_DSN, connect=lambda _dsn, **_kw: conn)
        store.delete_extension(extension="101", auth_ids=["101_bbbb2222", "101_aaaa1111"])

        self.assertEqual(conn.transactions_started, 1)
        self.assertEqual(conn.transactions_committed, 1)
        self.assertTrue(conn.closed)
        self.assertEqual(
            conn.statements,
            [
                (DELETE_ENDPOINT_SQL, ("101",)),
                (DELETE_AOR_SQL, ("101",)),
                (DELETE_AUTH_SQL, ("101_bbbb2222",)),
                (DELETE_AUTH_SQL, ("101_aaaa1111",)),
                (DELETE_ORPHAN_AUTHS_SQL, ("101\\_%",)),
            ],
        )
        # PostgreSQL standard_conforming_strings requires ESCAPE '\' to be a single backslash character.
        self.assertTrue(DELETE_ORPHAN_AUTHS_SQL.endswith("ESCAPE '\\'"))
        self.assertEqual(_escape_like_prefix("10_1%\\"), "10\\_1\\%\\\\")

    def test_os_error_wraps_into_pbx_store_error_without_leaking_dsn_or_password(self) -> None:
        def broken_connect(_dsn: str, **_kw):
            raise OSError(f"connection to {TEST_DSN} failed")

        store = PostgresPbxStore(TEST_DSN, connect=broken_connect)
        with self.assertLogs("pbx_agent.pbx_db", level=logging.WARNING) as logs, self.assertRaises(PbxStoreError) as caught:
            store.delete_extension(extension="101", auth_ids=[])

        self.assertEqual(str(caught.exception), "pbx database write failed")
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertNotIn(SECRET_PASSWORD, str(caught.exception))
        self.assertNotIn("pbx-db", str(caught.exception))
        for record in logs.output:
            self.assertNotIn(SECRET_PASSWORD, record)
            self.assertNotIn("pbx-db", record)

    def test_psycopg_error_rolls_back_and_never_leaks_dsn_or_password(self) -> None:
        class FakePsycopgError(Exception):
            pass

        conn = FakeConnection(fail_on_execute=FakePsycopgError(f"auth failed for {TEST_DSN}"))
        class FakePsycopg(types.ModuleType):
            Error = FakePsycopgError

            @staticmethod
            def connect(_dsn: str, **_kw) -> FakeConnection:
                return conn

        fake_psycopg = FakePsycopg("psycopg")

        store = PostgresPbxStore(TEST_DSN)
        patched = mock.patch.dict(sys.modules, {"psycopg": fake_psycopg})
        with patched, self.assertLogs("pbx_agent.pbx_db", level=logging.WARNING) as logs, self.assertRaises(PbxStoreError) as caught:
            store.upsert_extension_session(
                extension="101",
                auth_id="101_a1b2c3d4",
                auth_username="101-a1b2c3d4",
                password="session-password",
                auth_ids=["101_a1b2c3d4"],
                session_seconds=120,
                transport="transport-ws",
                context="from-extension",
                from_domain="acme.example.test",
            )

        self.assertEqual(str(caught.exception), "pbx database write failed")
        self.assertEqual(conn.transactions_rolled_back, 1)
        self.assertEqual(conn.transactions_committed, 0)
        self.assertTrue(conn.closed)
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertNotIn(SECRET_PASSWORD, str(caught.exception))
        for record in logs.output:
            self.assertNotIn(SECRET_PASSWORD, record)
            self.assertNotIn("session-password", record)

    def test_missing_psycopg_raises_pbx_store_error(self) -> None:
        store = PostgresPbxStore(TEST_DSN)
        patched = mock.patch.dict(sys.modules, {"psycopg": None})
        with patched, self.assertLogs("pbx_agent.pbx_db", level=logging.WARNING) as logs, self.assertRaises(PbxStoreError) as caught:
            store.delete_extension(extension="101", auth_ids=[])
        self.assertEqual(str(caught.exception), "pbx database write failed")
        for record in logs.output:
            self.assertNotIn(SECRET_PASSWORD, record)


if __name__ == "__main__":
    unittest.main()
