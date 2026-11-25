import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.settings import Settings, SettingsError  # noqa: E402

EVENTS_KEY = "11" * 32
REVERSE_KEY = "22" * 32


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
        self.assertEqual(settings.events_key, bytes.fromhex(EVENTS_KEY))
        self.assertEqual(settings.reverse_key, bytes.fromhex(REVERSE_KEY))
        self.assertEqual(settings.ari_url, "http://ari:8088/ari")
        self.assertEqual(settings.listen_port, 8601)
        self.assertEqual(settings.reconcile_seconds, 300)
        self.assertEqual(settings.public_host, "acme.example.com")
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
        settings = Settings.from_env(self.environ)
        shown = repr(settings)
        self.assertNotIn("not-a-real-password", shown)
        self.assertNotIn(settings.events_key.hex(), shown)
        self.assertNotIn(settings.reverse_key.hex(), shown)

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


if __name__ == "__main__":
    unittest.main()
