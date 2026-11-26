import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pbx_agent.recordings import recording_path  # noqa: E402


class RecordingPathTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "recordings"
        self.root.mkdir()

    def test_a_known_call_resolves_inside_the_directory(self) -> None:
        call_id = "1700000000.42"
        (self.root / f"{call_id}.wav").write_bytes(b"RIFF")
        self.assertEqual(recording_path(self.root, call_id), (self.root / f"{call_id}.wav").resolve())

    def test_traversal_attempts_are_refused(self) -> None:
        outside = Path(self.temporary.name) / "secret.wav"
        outside.write_bytes(b"secret")
        for call_id in (
            "",
            ".",
            "..",
            "../secret",
            "../../etc/passwd",
            "/etc/passwd",
            "a/b",
            "a\\b",
            "..%2fsecret",
            "1700000000.42\x00",
        ):
            self.assertIsNone(recording_path(self.root, call_id), call_id)

    def test_a_missing_file_is_not_found(self) -> None:
        self.assertIsNone(recording_path(self.root, "1700000000.99"))

    def test_a_symlink_leaving_the_directory_is_refused(self) -> None:
        outside = Path(self.temporary.name) / "outside.wav"
        outside.write_bytes(b"secret")
        (self.root / "1700000000.42.wav").symlink_to(outside)
        self.assertIsNone(recording_path(self.root, "1700000000.42"))

    def test_a_directory_named_like_a_recording_is_refused(self) -> None:
        (self.root / "1700000000.42.wav").mkdir()
        self.assertIsNone(recording_path(self.root, "1700000000.42"))

    def test_a_non_string_is_refused(self) -> None:
        self.assertIsNone(recording_path(self.root, None))


if __name__ == "__main__":
    unittest.main()
