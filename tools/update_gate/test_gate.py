# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Focused tests for the update approval gate."""

from __future__ import annotations

import io
import json
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import gate


class _TTYBuffer(io.StringIO):
    def isatty(self) -> bool:
        return True


def valid_report(cwd: Path) -> dict:
    return {
        "id": "update-2026-09-09-001",
        "classification": "mixed",
        "components": [
            {
                "name": "example-package",
                "from": "1.0.0",
                "to": "1.1.0",
                "sources": ["https://example.com/security-advisory"],
                "security": "addresses the published issue",
                "non_security": "includes upstream maintenance changes",
            },
        ],
        "impact": {
            "odoo_core": "no direct core source change",
            "meetings": "meeting attachments require the existing smoke test",
            "pmo": "project API regression check",
            "hr": "HR API regression check",
            "access": "permission regression check",
            "chat": "chat surface is unchanged",
            "frontend": "contract and browser checks",
            "customizations": "customer overlays remain on their current versions",
        },
        "verification_plan": ["run focused dependency and API checks"],
        "rollback_plan": "restore the recorded lockfile and restart the isolated service",
        "actions": [
            {
                "cwd": str(cwd),
                "tool_name": "Bash",
                "tool_input": {"command": "npm install example-package@1.1.0"},
            },
            {
                "cwd": str(cwd),
                "tool_name": "Edit",
                "tool_input": {"file_path": "package.json", "new_string": "safe"},
            },
        ],
    }


class ReportTests(unittest.TestCase):
    def test_report_validation_is_strict_and_digest_changes_with_ordered_actions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory)
            report = valid_report(cwd)
            report_path = cwd / "report.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            checked, digest, _ = gate.load_report(report_path)
            self.assertEqual(checked["actions"][0]["tool_name"], "Bash")

            reordered = dict(checked)
            reordered["actions"] = list(reversed(checked["actions"]))
            self.assertNotEqual(digest, gate.report_digest(reordered))

            report["impact"]["chat"] = "TODO"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaises(gate.GateError):
                gate.load_report(report_path)

    def test_validate_cli_is_read_only_and_malformed_payload_denies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory)
            report_path = cwd / "report.json"
            report_path.write_text(json.dumps(valid_report(cwd)), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.command_validate(str(report_path)), 0)
            self.assertIn('"valid": true', output.getvalue())

            state_dir = cwd / "state"
            payload = {"tool_name": "Bash", "tool_input": {"command": "npm install"}, "cwd": str(cwd)}
            with patch("sys.stdin", io.StringIO(json.dumps(payload))), redirect_stderr(io.StringIO()):
                self.assertEqual(gate.command_check(state_dir), 2)
            self.assertFalse((state_dir / "approved.json").exists())


class ClassificationTests(unittest.TestCase):
    def test_read_only_and_product_work_are_allowed(self) -> None:
        cwd = "/tmp/nasq-gate"
        allowed, _, _ = gate.classify_payload({"tool_name": "Bash", "tool_input": {"command": "rg package.json"}, "cwd": cwd})
        self.assertFalse(allowed)
        allowed, _, _ = gate.classify_payload({"tool_name": "Edit", "tool_input": {"file_path": "apps/web/app/page.vue"}, "cwd": cwd})
        self.assertFalse(allowed)

    def test_updates_and_protected_files_require_approval(self) -> None:
        cwd = "/tmp/nasq-gate"
        for payload in (
            {"tool_name": "Bash", "tool_input": {"command": "pip install pypdf"}, "cwd": cwd},
            {"tool_name": "Bash", "tool_input": {"command": "npm audit fix"}, "cwd": cwd},
            {"tool_name": "Bash", "tool_input": {"command": "echo changed > package.json"}, "cwd": cwd},
            {"tool_name": "Edit", "tool_input": {"file_path": "package.json"}, "cwd": cwd},
            {"tool_name": "MultiEdit", "tool_input": {"edits": [{"filePath": "docs/UPDATE_POLICY.md"}]}, "cwd": cwd},
            {"tool_name": "apply_patch", "tool_input": {"command": "*** Begin Patch\n*** Update File: .claude/settings.json\n*** End Patch"}, "cwd": cwd},
        ):
            requires, _, _ = gate.classify_payload(payload)
            self.assertTrue(requires, payload)

    def test_prefixed_and_segmented_update_commands_require_approval(self) -> None:
        cwd = "/tmp/nasq-gate"
        commands = (
            "# Update dependencies\nnpm update",
            "npm audit # inventory\nnpm update",
            "echo '# harmless'; npm update",
            "npm \\\nupdate",
            "npm ci --ignore-scripts; npm update",
            "bash -c 'echo ok'; npm update",
            "npm audit && python3 /Users/tariq/code/odoo/odoo-bin -u nasq_core",
            "echo ok\npython3 /Users/tariq/code/odoo/odoo-bin -u nasq_core",
            "ENVIRONMENT=staging npm install example-package",
            "sudo npm install example-package",
            "sudo pip install requests",
            "env -i npm i vue",
            "npm ci", "npm exec --yes shadcn@latest add button", "yarn",
            "pip --python /tmp/venv/bin/python install requests",
            "uv tool install ruff", "corepack prepare yarn@latest --activate",
            "python3 /Users/tariq/code/odoo/odoo-bin -u nasq_pmo",
            "python -c \"env['x'].button_immediate_upgrade()\"",
        )
        for command in commands:
            requires, _, _ = gate.classify_payload({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": cwd})
            self.assertTrue(requires, command)

    def test_non_odoo_short_flags_remain_read_only(self) -> None:
        for command in (
            "rg -u pattern", "rg --update pattern", "rg -i package.json",
            "rg update package.json | head -20", "sed -n '1,20p' package.json",
            "cat requirements.txt | head", "# npm update\nnpm audit",
        ):
            requires, _, _ = gate.classify_payload({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": "/tmp/nasq-gate"})
            self.assertFalse(requires, command)

    def test_read_only_docker_uv_and_ordinary_git_workflow_remain_allowed(self) -> None:
        for command in ("docker compose ps", "docker compose config", "uv pip list", "git checkout feature/ui"):
            requires, _, _ = gate.classify_payload({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": "/tmp/nasq-gate"})
            self.assertFalse(requires, command)
        for command in ("cd /Users/tariq/code/odoo && git checkout 19.0", "git -C /Users/tariq/code/odoo reset --hard HEAD"):
            requires, _, _ = gate.classify_payload({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": "/tmp/nasq-gate"})
            self.assertTrue(requires, command)

    def test_frozen_replay_and_nested_obvious_shell_are_classified(self) -> None:
        frozen = {"tool_name": "Bash", "tool_input": {"command": "npm ci --ignore-scripts"}, "cwd": "/tmp/nasq-gate"}
        requires, _, _ = gate.classify_payload(frozen)
        self.assertFalse(requires)
        nested = {"tool_name": "Bash", "tool_input": {"command": "bash -c 'npm install x'"}, "cwd": "/tmp/nasq-gate"}
        requires, _, _ = gate.classify_payload(nested)
        self.assertTrue(requires)


class ApprovalConsumptionTests(unittest.TestCase):
    def test_exact_ordered_actions_consume_once_and_mismatch_does_not_consume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory)
            report_path = cwd / "report.json"
            report = valid_report(cwd)
            report_path.write_text(json.dumps(report), encoding="utf-8")
            _checked, digest, resolved = gate.load_report(report_path)
            state_dir = cwd / "state"
            (state_dir).mkdir()
            (state_dir / "approved.json").write_text(
                json.dumps({"report_path": str(resolved), "digest": digest, "index": 0, "expires": time.time() + 3600}),
                encoding="utf-8",
            )
            first = {"tool_name": "Bash", "tool_input": {"command": "npm install example-package@1.1.0"}, "cwd": str(cwd)}
            second = {"tool_name": "Edit", "tool_input": {"file_path": "package.json", "new_string": "safe"}, "cwd": str(cwd)}
            self.assertEqual(gate.consume_approval(first, state_dir)[0], True)
            mismatch = {"tool_name": "Bash", "tool_input": {"command": "npm install wrong"}, "cwd": str(cwd)}
            self.assertEqual(gate.consume_approval(mismatch, state_dir)[0], False)
            self.assertEqual(gate.consume_approval(second, state_dir)[0], True)
            self.assertEqual(gate.consume_approval(second, state_dir)[0], False)

            report["rollback_plan"] = "changed after approval"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            self.assertEqual(gate.consume_approval(first, state_dir)[0], False)

    def test_expired_approval_denies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory)
            report_path = cwd / "report.json"
            report_path.write_text(json.dumps(valid_report(cwd)), encoding="utf-8")
            _, digest, resolved = gate.load_report(report_path)
            state_dir = cwd / "state"
            state_dir.mkdir()
            (state_dir / "approved.json").write_text(
                json.dumps({"report_path": str(resolved), "digest": digest, "index": 0, "expires": time.time() - 1}),
                encoding="utf-8",
            )
            payload = {"tool_name": "Bash", "tool_input": {"command": "npm install example-package@1.1.0"}, "cwd": str(cwd)}
            self.assertEqual(gate.consume_approval(payload, state_dir)[0], False)


class HumanApprovalTests(unittest.TestCase):
    def test_approve_requires_tty_and_exact_digest_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory)
            report_path = cwd / "report.json"
            report_path.write_text(json.dumps(valid_report(cwd)), encoding="utf-8")
            state_dir = cwd / "state"
            with patch("sys.stdin", io.StringIO()), patch("sys.stdout", io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(gate.command_approve(str(report_path), state_dir), 2)
            self.assertFalse((state_dir / "approved.json").exists())

            _, digest, _ = gate.load_report(report_path)
            stdin = _TTYBuffer(f"approve {digest}\n")
            stdout = _TTYBuffer()
            with patch("sys.stdin", stdin), patch("sys.stdout", stdout):
                self.assertEqual(gate.command_approve(str(report_path), state_dir), 0)
            state = json.loads((state_dir / "approved.json").read_text(encoding="utf-8"))
            self.assertEqual(state["digest"], digest)
            self.assertEqual(state["index"], 0)


if __name__ == "__main__":
    unittest.main()
