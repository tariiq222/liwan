# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Protocol tests: never execute a package manager or create a real approval."""

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("nasq_update_adapter", HERE / "adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def test_shell_aliases_and_effective_directory(self):
        for name in ("Bash", "exec_command", "run_terminal_command", "run_in_terminal", "run_shell_command", "Shell"):
            with self.subTest(name=name):
                result = adapter.normalize("native", {
                    "tool_name": name, "cwd": "/workspace",
                    "tool_input": {"command": "npm update", "workdir": "/target", "timeout": 3},
                })
                self.assertEqual(result, {"tool_name": "Bash", "cwd": "/target", "tool_input": {"command": "npm update"}})

    def test_grok_and_compatibility_deduplication(self):
        payload = {"toolName": "run_terminal_command", "toolInput": {"command": "npm update"}, "cwd": "/repo"}
        self.assertEqual(adapter.normalize("grok", payload)["tool_name"], "Bash")
        self.assertIsNone(adapter.normalize("claude", payload))
        self.assertIsNone(adapter.normalize("cursor", payload))
        cursor = {"tool_name": "Shell", "tool_input": {"command": "npm update"}, "cursor_version": "test"}
        self.assertIsNone(adapter.normalize("claude", cursor))
        self.assertEqual(adapter.normalize("cursor", cursor)["tool_name"], "Bash")

    def test_edit_and_patch_shapes(self):
        edit = adapter.normalize("copilot", {"tool_name": "replace_string_in_file", "tool_input": {"filePath": "/repo/package.json", "oldString": "old", "newString": "new"}})
        self.assertEqual(edit["tool_name"], "Edit")
        self.assertEqual(edit["tool_input"]["file_path"], "/repo/package.json")
        patch = "*** Begin Patch\n*** Update File: package.json\n@@\n-a\n+b\n*** End Patch"
        for key in ("command", "patchText", "patch"):
            self.assertEqual(adapter.normalize("codex", {"tool_name": "apply_patch", "tool_input": {key: patch}})["tool_input"], {"command": patch})

    def run_stub(self, provider, body, payload):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copy2(HERE / "adapter.py", root / "adapter.py")
            (root / "gate.py").write_text(body)
            return subprocess.run([sys.executable, str(root / "adapter.py"), provider], input=json.dumps(payload), text=True, capture_output=True, check=False)

    def test_all_protocols_deny_on_engine_failure(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "npm update"}, "cwd": "/repo"}
        for provider in ("codex", "claude", "grok", "copilot", "gemini", "cursor", "opencode"):
            with self.subTest(provider=provider):
                result = self.run_stub(provider, "raise RuntimeError('fixture failure')", payload)
                self.assertEqual(result.returncode, 2)
                self.assertIn("fixture failure", result.stderr)

    def test_allow_is_silent_and_malformed_is_denied(self):
        payload = {"tool_name": "Read", "tool_input": {"file_path": "/repo/package.json"}, "cwd": "/repo"}
        result = self.run_stub("codex", "pass", payload)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        for invalid in ([], {"tool_name": []}, {"tool_name": "Bash", "tool_input": []}):
            self.assertEqual(self.run_stub("codex", "pass", invalid).returncode, 2)

    def test_installer_preserves_existing_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".claude").mkdir()
            legacy = {"matcher": "Bash", "hooks": [{"type": "command", "command": "original-guard"}]}
            (root / ".claude/settings.json").write_text(json.dumps({"hooks": {"PreToolUse": [legacy]}, "unrelated": True}))
            (root / "AGENTS.md").write_text("User instructions must survive.\n")
            command = [sys.executable, str(HERE / "install.py"), "--root", str(root), "--apply"]
            first = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            settings = json.loads((root / ".claude/settings.json").read_text())
            self.assertEqual(settings["hooks"]["PreToolUse"][0], legacy)
            self.assertTrue(settings["unrelated"])
            self.assertIn("User instructions must survive.", (root / "AGENTS.md").read_text())
            second = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(json.loads(second.stdout)["files"], [])


if __name__ == "__main__":
    unittest.main()
