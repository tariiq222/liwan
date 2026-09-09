# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Normalize runner payloads. Deny on malformed matched calls or gate failures."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def normalize(provider, payload):
    if not isinstance(payload, dict):
        message = "hook payload must be an object"
        raise TypeError(message)
    # Grok also discovers Claude and Cursor settings. Only the dedicated Grok
    # adapter handles its camelCase payload, to avoid consuming approval twice.
    if provider in {"claude", "cursor"} and "toolName" in payload:
        return None
    if provider == "claude" and "cursor_version" in payload:
        return None  # Cursor also supports importing Claude hook definitions.
    name = payload.get("tool_name", payload.get("toolName", ""))
    if not isinstance(name, str):
        message = "tool name must be a string"
        raise TypeError(message)
    args = payload.get("tool_input", payload.get("toolInput", payload.get("toolArgs", {})))
    if isinstance(args, str):
        args = json.loads(args)
    if not isinstance(args, dict):
        message = "tool arguments must be an object"
        raise TypeError(message)
    if provider == "cursor" and not name and "command" in payload:
        name, args = "Bash", {"command": payload["command"]}
    aliases = {
        "bash": "Bash", "shell": "Bash", "run_shell_command": "Bash",
        "exec_command": "Bash", "run_terminal_cmd": "Bash",
        "run_terminal_command": "Bash", "run_in_terminal": "Bash",
        "edit": "Edit", "replace": "Edit", "str_replace_editor": "Edit",
        "search_replace": "Edit", "replace_string_in_file": "Edit",
        "multi_replace_string_in_file": "MultiEdit",
        "write": "Write", "write_file": "Write", "create_file": "Write", "create": "Write",
        "delete": "Write", "delete_file": "Write", "strreplace": "Edit",
        "apply_patch": "apply_patch", "multiedit": "MultiEdit",
    }
    cwd = args.get("workdir") or args.get("working_directory") or args.get("cwd") or payload.get("cwd") or payload.get("workingDirectory") or os.getcwd()
    name = aliases.get(name.lower(), name)
    if name not in {"Bash", "Edit", "Write", "MultiEdit", "apply_patch"}:
        if not name or re.search(r"exec|shell|terminal|write_file|edit_file|patch|replace_string|install", name.lower()):
            raise ValueError(f"unrecognized execution/edit tool: {name}; review its adapter before use")
        return None  # Read/search/reasoning and other tools have policy-only coverage.
    if name == "Bash":
        args = {"command": args.get("command", args.get("cmd", ""))}
    elif name == "apply_patch":
        args = {"command": args.get("command", args.get("patchText", args.get("patch", "")))}
    else:
        args = dict(args)
        if "filePath" in args:
            args["file_path"] = args.pop("filePath")
    return {"tool_name": name, "tool_input": args, "cwd": cwd}


def main():
    provider = sys.argv[1] if len(sys.argv) == 2 else "unknown"
    try:
        event = normalize(provider, json.load(sys.stdin))
        if event is None:
            if provider == "cursor":
                sys.stdout.write('{"permission":"allow"}\n')
            return 0
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("gate.py")), "check"],
            input=json.dumps(event), text=True, capture_output=True, timeout=8,
            check=False,
        )
        denied = result.returncode != 0
        reason = result.stderr.strip() or "Update gate failed; stop and inspect the gate."
    except Exception as exc:  # noqa: BLE001 — guard errors must become exit 2.
        denied, reason = True, f"Update gate payload/runtime failure: {exc}"
    if denied:
        if provider == "copilot":
            sys.stdout.write(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse", "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }}) + "\n")
        elif provider == "cursor":
            sys.stdout.write(json.dumps({"permission": "deny", "user_message": reason, "agent_message": reason}) + "\n")
        elif provider == "gemini":
            sys.stdout.write(json.dumps({"decision": "deny", "reason": reason}) + "\n")
        sys.stderr.write(reason + "\n")
        return 2
    if provider == "cursor":
        sys.stdout.write('{"permission":"allow"}\n')
    return 0


if __name__ == "__main__":
    sys.exit(main())
