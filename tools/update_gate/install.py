# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Install only the update gate; preserve config and back up every changed file."""

import argparse
import hashlib
import json
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/Users/tariq/code/nasq"))
    parser.add_argument("--all-worktrees", action="store_true")
    parser.add_argument("--apply", action="store_true")
    opts = parser.parse_args()
    root = opts.root.resolve()
    source = Path(__file__).resolve().parents[2]
    roots = [root]
    if opts.all_worktrees:
        result = subprocess.run(
            ["git", "-C", str(root), "worktree", "list", "--porcelain", "-z"],
            check=True, capture_output=True, text=True,
        )
        roots = [Path(x[9:]) for x in result.stdout.split("\0") if x.startswith("worktree ")]
    if not roots or root not in roots:
        message = "canonical root missing from worktree inventory"
        raise ValueError(message)
    changes = {}
    before = {}

    def put(path, text):
        data = text.encode("utf-8")
        if path.is_symlink():
            raise ValueError(f"refusing to replace symlink: {path}")
        previous = path.read_bytes() if path.exists() else None
        before.setdefault(path, previous)
        if previous != data:
            changes[path] = data

    def merge_hook(path, event, entry):
        data = json.loads(path.read_text()) if path.exists() else {}
        hooks = data.setdefault("hooks", {}).setdefault(event, [])
        # Replace only our previous generated entry. Preserve all other hooks.
        hooks[:] = [item for item in hooks if str(root / "tools/update_gate/adapter.py") not in json.dumps(item)]
        hooks.append(entry)
        put(path, json.dumps(data, indent=2) + "\n")

    def command(provider):
        return f"python3 {shlex.quote(str(root / 'tools/update_gate/adapter.py'))} {provider} || exit 2"

    def pre_entry(provider):
        return {"matcher": ".*", "hooks": [{"type": "command", "command": command(provider), "timeout": 10}]}

    # One canonical implementation for all worktrees. Nothing executes an update.
    for name in ("gate.py", "adapter.py", "install.py", "test_gate.py", "test_adapters.py", "opencode-plugin.mjs", "README.md", "report-template.json"):
        put(root / "tools/update_gate" / name, (source / "tools/update_gate" / name).read_text())
    put(root / "docs/UPDATE_POLICY.md", (source / "docs/UPDATE_POLICY.md").read_text())
    begin, end = "<!-- NASQ UPDATE GATE BEGIN -->", "<!-- NASQ UPDATE GATE END -->"
    block = f"""{begin}
## Mandatory update approval

Read `{root}/docs/UPDATE_POLICY.md` before any dependency, Odoo, addon,
vendor, runtime or database-module update. This applies to all agents and tools.
First inspect exact changes and security-vs-core/customization impacts, present
an Arabic report, then wait for Tariq's explicit approval of that exact proposal.
Security-only updates also require approval. Never bypass a denial, disable hooks,
forge an approval record or answer a human confirmation prompt. Earlier general
permission to update is superseded. New tools/delegates must inherit this rule.
Hook mechanics and actual coverage: `{root}/tools/update_gate/README.md`.
{end}
"""
    for checkout in roots:
        for name in ("AGENTS.md", "CLAUDE.md", "GEMINI.md", "GROK.md", ".github/copilot-instructions.md"):
            path = checkout / name
            text = path.read_text() if path.exists() else "# Nasq project instructions\n"
            if begin in text:
                start = text.index(begin)
                stop = text.index(end, start) + len(end)
                text = text[:start] + text[stop:].lstrip("\n")
            put(path, block + "\n" + text)
        put(checkout / ".cursor/rules/nasq-updates.mdc", "---\ndescription: Mandatory Nasq update approval\nalwaysApply: true\n---\n\n" + block)
        merge_hook(checkout / ".claude/settings.json", "PreToolUse", pre_entry("claude"))
        merge_hook(checkout / ".codex/hooks.json", "PreToolUse", pre_entry("codex"))
        merge_hook(checkout / ".grok/hooks/nasq-update-gate.json", "PreToolUse", pre_entry("grok"))
        merge_hook(checkout / ".gemini/settings.json", "BeforeTool", {
            "hooks": [{"type": "command", "command": command("gemini"), "timeout": 10000}],
        })
        cursor = checkout / ".cursor/hooks.json"
        merge_hook(cursor, "preToolUse", {"command": command("cursor"), "failClosed": True, "timeout": 10})
        cursor_data = json.loads(changes[cursor]) if cursor in changes else json.loads(cursor.read_text())
        cursor_data.setdefault("version", 1)
        put(cursor, json.dumps(cursor_data, indent=2) + "\n")
        merge_hook(checkout / ".github/hooks/nasq-update-gate.json", "PreToolUse", {
            "type": "command", "command": command("copilot"), "timeout": 10,
        })
        plugin = (source / "tools/update_gate/opencode-plugin.mjs").read_text().replace("/Users/tariq/code/nasq", str(root))
        put(checkout / ".opencode/plugins/nasq-update-gate.js", plugin)
    sys.stdout.write(json.dumps({"apply": opts.apply, "worktrees": len(roots), "files": [str(p) for p in changes]}, indent=2) + "\n")
    if not opts.apply or not changes:
        return
    backup = root / ".runtime/update-gate-install" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True, mode=0o700)
    manifest = []
    for path, content in changes.items():
        if opts.all_worktrees and any(not (checkout / ".git").exists() for checkout in roots):
            message = "worktree inventory changed during installation; stop and inspect backups"
            raise RuntimeError(message)
        previous = path.read_bytes() if path.exists() else None
        if previous != before[path]:
            message = f"file changed during preflight; rerun installer: {path}"
            raise RuntimeError(message)
        item = {"path": str(path), "existed": previous is not None, "sha256_after": hashlib.sha256(content).hexdigest()}
        if previous is not None:
            saved = backup / str(len(manifest))
            saved.write_bytes(previous)
            saved.chmod(0o600)
            item["backup"] = str(saved)
        manifest.append(item)
    (backup / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for path, content in changes.items():
        previous = path.read_bytes() if path.exists() else None
        if previous != before[path]:
            message = f"file changed during installation; backups preserved: {path}"
            raise RuntimeError(message)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    sys.stdout.write(f"Backup and installed-file hashes: {backup / 'manifest.json'}\n")


if __name__ == "__main__":
    main()
