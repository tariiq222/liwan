from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.settings import Settings, SettingsError  # noqa: E402

EVENTS_KEY = "11" * 32
REVERSE_KEY = "22" * 32
TURN_SECRET = "t" * 32


class SettingsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.recordings = self.root / "recordings"
        self.recordings.mkdir()
        self.environ = {
            "PBX_ARI_URL": "http://ari:8088/ari",
            "PBX_ARI_USERNAME": "liwan",
            "PBX_ARI_PASSWORD": "not-a-real-password",
            "PBX_DB_URL": "postgresql://pbx:not-a-real-db-password@pbx-db:5432/telephony_pbx",
            "PBX_DATABASE": "liwan_acme",
            "PBX_EVENTS_KEY": EVENTS_KEY,
            "PBX_REVERSE_KEY": REVERSE_KEY,
            "PBX_RECORDINGS_DIR": str(self.recordings),
            "PBX_ODOO_EVENTS_URL": "http://odoo:8069/api/v1/telephony/events",
            "PBX_QUEUE_PATH": str(self.root / "queue.sqlite3"),
            "PBX_PUBLIC_HOST": "acme.example.com",
            "PBX_CEL_PATH": str(self.root / "cel.csv"),
        }

    def test_reads_a_complete_environment(self) -> None:
        settings = Settings.from_env(self.environ)
        self.assertEqual(settings.database, "liwan_acme")
        self.assertEqual(settings.pbx_db_url, "postgresql://pbx:not-a-real-db-password@pbx-db:5432/telephony_pbx")
        self.assertEqual(settings.events_key, bytes.fromhex(EVENTS_KEY))
        self.assertEqual(settings.reverse_key, bytes.fromhex(REVERSE_KEY))
        self.assertEqual(settings.ari_url, "http://ari:8088/ari")
        self.assertEqual(settings.listen_port, 8601)
        self.assertEqual(settings.reconcile_seconds, 300)
        self.assertEqual(settings.public_host, "acme.example.com")
        self.assertEqual(settings.public_ws_url, "wss://acme.example.com/ws")
        self.assertEqual(settings.session_seconds, 120)
        self.assertEqual(settings.session_overlap_seconds, 30)
        self.assertIsNone(settings.stun_url)
        self.assertIsNone(settings.turn_url)
        self.assertIsNone(settings.turn_secret)
        self.assertIsNone(settings.line_endpoint)

    def test_a_missing_variable_names_itself_and_no_value(self) -> None:
        del self.environ["PBX_ARI_PASSWORD"]
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_ARI_PASSWORD")
        self.assertIn("PBX_ARI_PASSWORD", str(caught.exception))

    def test_one_derived_key_without_the_other_names_the_missing_one(self) -> None:
        del self.environ["PBX_REVERSE_KEY"]
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_REVERSE_KEY")

    def test_a_short_key_is_refused_without_repeating_it(self) -> None:
        self.environ["PBX_EVENTS_KEY"] = "abcd"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_EVENTS_KEY")
        self.assertNotIn("abcd", str(caught.exception))

    def test_the_repr_hides_every_secret(self) -> None:
        self.environ["PBX_TURN_URL"] = "turns:turn.example.com:5349"
        self.environ["PBX_TURN_SECRET"] = TURN_SECRET
        settings = Settings.from_env(self.environ)
        shown = repr(settings)
        self.assertNotIn("not-a-real-password", shown)
        self.assertNotIn("not-a-real-db-password", shown)
        self.assertNotIn("pbx-db", shown)
        self.assertNotIn(settings.events_key.hex(), shown)
        self.assertNotIn(settings.reverse_key.hex(), shown)
        self.assertNotIn(TURN_SECRET, shown)

    def test_keys_come_from_the_secret_file(self) -> None:
        keys_file = self.root / "keys"
        keys_file.write_text(f"# per-company keys\nevents={EVENTS_KEY}\nreverse={REVERSE_KEY}\n", encoding="utf-8")
        environ = dict(self.environ)
        del environ["PBX_EVENTS_KEY"]
        del environ["PBX_REVERSE_KEY"]
        environ["PBX_KEYS_FILE"] = str(keys_file)
        settings = Settings.from_env(environ)
        self.assertEqual(settings.events_key, bytes.fromhex(EVENTS_KEY))
        self.assertEqual(settings.reverse_key, bytes.fromhex(REVERSE_KEY))

    def test_a_keys_file_combined_with_a_direct_key_is_refused(self) -> None:
        keys_file = self.root / "keys"
        keys_file.write_text(f"events={EVENTS_KEY}\nreverse={REVERSE_KEY}\n", encoding="utf-8")
        self.environ["PBX_KEYS_FILE"] = str(keys_file)
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_KEYS_FILE")

    def test_an_incomplete_keys_file_is_refused(self) -> None:
        keys_file = self.root / "keys"
        keys_file.write_text(f"events={EVENTS_KEY}\n", encoding="utf-8")
        environ = dict(self.environ)
        del environ["PBX_EVENTS_KEY"]
        del environ["PBX_REVERSE_KEY"]
        environ["PBX_KEYS_FILE"] = str(keys_file)
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(environ)
        self.assertIn("reverse", str(caught.exception))

    def test_the_recordings_directory_must_exist(self) -> None:
        self.environ["PBX_RECORDINGS_DIR"] = str(self.root / "missing")
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_RECORDINGS_DIR")

    def test_a_relative_path_is_refused(self) -> None:
        self.environ["PBX_QUEUE_PATH"] = "queue.sqlite3"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_QUEUE_PATH")

    def test_an_interval_outside_its_bounds_is_refused(self) -> None:
        self.environ["PBX_RECONCILE_SECONDS"] = "5"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_RECONCILE_SECONDS")

    def test_a_url_with_credentials_is_refused(self) -> None:
        self.environ["PBX_ODOO_EVENTS_URL"] = "http://user:secret@odoo:8069/api/v1/telephony/events"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_ODOO_EVENTS_URL")

    def test_a_public_host_with_a_scheme_is_refused(self) -> None:
        self.environ["PBX_PUBLIC_HOST"] = "https://acme.example.com"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(self.environ)
        self.assertEqual(caught.exception.variable, "PBX_PUBLIC_HOST")

    def test_the_line_endpoint_is_optional(self) -> None:
        self.environ["PBX_LINE_ENDPOINT"] = "trunk_main"
        self.assertEqual(Settings.from_env(self.environ).line_endpoint, "trunk_main")

    def test_session_and_overlap_bounds_are_enforced(self) -> None:
        self.environ["PBX_SESSION_SECONDS"] = "30"
        self.environ["PBX_SESSION_OVERLAP_SECONDS"] = "0"
        settings = Settings.from_env(self.environ)
        self.assertEqual(settings.session_seconds, 30)
        self.assertEqual(settings.session_overlap_seconds, 0)

        for bad in ("29", "121", "abc"):
            env = dict(self.environ, PBX_SESSION_SECONDS=bad, PBX_SESSION_OVERLAP_SECONDS="10")
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_SESSION_SECONDS")

        for bad in ("-1", "61", "abc"):
            env = dict(self.environ, PBX_SESSION_SECONDS="120", PBX_SESSION_OVERLAP_SECONDS=bad)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_SESSION_OVERLAP_SECONDS")

        # Overlap must be strictly less than session_seconds.
        for session_s, overlap_s in (("30", "30"), ("40", "50")):
            env = dict(self.environ, PBX_SESSION_SECONDS=session_s, PBX_SESSION_OVERLAP_SECONDS=overlap_s)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_SESSION_OVERLAP_SECONDS")

    def test_stun_and_turn_urls_and_secret_are_validated(self) -> None:
        self.environ["PBX_STUN_URL"] = "stun:stun.example.com:3478"
        self.environ["PBX_TURN_URL"] = "turns:turn.example.com:5349"
        self.environ["PBX_TURN_SECRET"] = TURN_SECRET
        settings = Settings.from_env(self.environ)
        self.assertEqual(settings.stun_url, "stun:stun.example.com:3478")
        self.assertEqual(settings.turn_url, "turns:turn.example.com:5349")
        self.assertEqual(settings.turn_secret, TURN_SECRET)

        for bad_stun in ("http://stun.example.com", "turn:stun.example.com", "stun:", "stun:host with space"):
            env = dict(self.environ, PBX_STUN_URL=bad_stun)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_STUN_URL")

        for bad_turn in ("stun:turn.example.com", "https://turn.example.com", "turn:", "turn:host with space"):
            env = dict(self.environ, PBX_TURN_URL=bad_turn)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_TURN_URL")

        # TURN URL requires TURN secret.
        env_no_secret = dict(self.environ)
        del env_no_secret["PBX_TURN_SECRET"]
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(env_no_secret)
        self.assertEqual(caught.exception.variable, "PBX_TURN_SECRET")

        # Short or whitespace-containing TURN secret is refused without leaking its value.
        for bad_secret in ("short-secret", "a" * 31, "a" * 16 + " " + "b" * 16, " " + "a" * 32):
            env = dict(self.environ, PBX_TURN_SECRET=bad_secret)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_TURN_SECRET")
            self.assertNotIn(bad_secret.strip() or "short-secret", str(caught.exception))

        # Static PBX_TURN_USER / PBX_TURN_CREDENTIAL are never used as fallback.
        env_legacy = dict(self.environ)
        del env_legacy["PBX_TURN_SECRET"]
        env_legacy["PBX_TURN_USER"] = "legacy-user"
        env_legacy["PBX_TURN_CREDENTIAL"] = "legacy-credential"
        with self.assertRaises(SettingsError) as caught:
            Settings.from_env(env_legacy)
        self.assertEqual(caught.exception.variable, "PBX_TURN_SECRET")

    def test_websocket_url_and_pjsip_names_are_validated(self) -> None:
        self.environ["PBX_PUBLIC_WS_URL"] = "ws://localhost:8088/ws"
        self.assertEqual(Settings.from_env(self.environ).public_ws_url, "ws://localhost:8088/ws")

        for bad_ws in ("https://acme.example.com/ws", "wss://user:pass@acme.example.com/ws", "wss://acme.example.com/ws?a=1"):
            env = dict(self.environ, PBX_PUBLIC_WS_URL=bad_ws)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_PUBLIC_WS_URL")

        for var in ("PBX_PJSIP_TRANSPORT", "PBX_PJSIP_CONTEXT"):
            env = dict(self.environ, **{var: "bad name/with space"})
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, var)

    def test_pbx_db_url_is_required_validated_and_never_leaked(self) -> None:
        # Accepts postgres:// scheme and query parameters such as sslmode.
        env_short = dict(self.environ, PBX_DB_URL="postgres://pbx:pw@pbx-db/telephony_pbx?sslmode=disable")
        self.assertEqual(
            Settings.from_env(env_short).pbx_db_url,
            "postgres://pbx:pw@pbx-db/telephony_pbx?sslmode=disable",
        )

        # Missing or blank -> SettingsError naming PBX_DB_URL.
        for missing_val in (None, "", "   "):
            env = dict(self.environ)
            if missing_val is None:
                del env["PBX_DB_URL"]
            else:
                env["PBX_DB_URL"] = missing_val
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_DB_URL")

        # Malformed URLs (wrong scheme, whitespace, missing host/db, bad port, fragment) never leak password.
        secret = "leak-check-db-pass"
        for bad in (
            f"http://pbx:{secret}@pbx-db:5432/telephony_pbx",
            f"sqlite:///{secret}.db",
            f"postgresql://pbx:{secret}@pbx-db:5432/telephony pbx",
            f" postgresql://pbx:{secret}@pbx-db:5432/telephony_pbx",
            f"postgresql://pbx:{secret}@pbx-db:5432/",
            f"postgresql://pbx:{secret}@/telephony_pbx",
            f"postgresql://pbx:{secret}@pbx-db:notaport/telephony_pbx",
            f"postgresql://pbx:{secret}@pbx-db:5432/telephony_pbx#frag",
        ):
            env = dict(self.environ, PBX_DB_URL=bad)
            with self.assertRaises(SettingsError) as caught:
                Settings.from_env(env)
            self.assertEqual(caught.exception.variable, "PBX_DB_URL")
            self.assertNotIn(secret, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
