# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail-closed update approval gate.

The gate is deliberately small and standard-library-only.  ``check`` is a
pre-tool hook: it accepts one JSON object on stdin and never creates an
approval.  ``approve`` is an interactive, human-operated command that binds a
validated report and its ordered actions to a canonical SHA-256 digest.

This is an accidental-update guard, not authentication against another
process running as the same operating-system user.  Shell strings that use
opaque encoding or arbitrary dynamic evaluation cannot be perfectly inspected;
they are denied when recognized and otherwise remain outside the guarantees of
this local hook.
"""

from __future__ import annotations

# ruff: noqa: T201
import argparse
import hashlib
import json
import os
import re
import shlex
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, NoReturn
from urllib.parse import urlparse

if TYPE_CHECKING:
    from collections.abc import Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback is exercised only there.
    fcntl = None  # type: ignore[assignment]


DEFAULT_STATE_DIR = Path("/Users/tariq/code/nasq/.runtime/update-approval")
REPORT_CLASSIFICATIONS = {"security_only", "mixed", "core", "unknown"}
REPORT_KEYS = {
    "id",
    "classification",
    "components",
    "impact",
    "verification_plan",
    "rollback_plan",
    "actions",
}
IMPACT_KEYS = {
    "odoo_core",
    "meetings",
    "pmo",
    "hr",
    "access",
    "chat",
    "frontend",
    "customizations",
}
COMPONENT_KEYS = {"name", "from", "to", "sources", "security", "non_security"}
ACTION_KEYS = {"cwd", "tool_name", "tool_input"}
TOOL_ALIASES = {
    "bash": "Bash",
    "shell": "Bash",
    "Bash": "Bash",
    "edit": "Edit",
    "Edit": "Edit",
    "write": "Write",
    "Write": "Write",
    "MultiEdit": "Edit",
    "multi_edit": "Edit",
    "apply_patch": "apply_patch",
    "ApplyPatch": "apply_patch",
}
PROTECTED_BASENAMES = {
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "pnpm-lock.yml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "uv.lock",
    "poetry.lock",
    "pyproject.toml",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "AGENTS.md",
    "CLAUDE.md",
}
PROTECTED_PATH_PARTS = (
    "cyan_meeting_minutes",
    "web_theme_shadcn",
    "tools/update_gate",
    ".runtime/update-approval",
    ".claude/settings",
    ".cursor",
    ".codex/hooks.json",
    ".grok/hooks",
    ".github/hooks",
    ".opencode/plugins/nasq-update-gate.js",
    "docs/UPDATE_POLICY.md",
    "/odoo/",
    "/odoo-runtime/",
)
MUTATING_COMMANDS = {
    "add",
    "apply",
    "build",
    "checkout",
    "compose",
    "install",
    "pull",
    "remove",
    "reset",
    "sync",
    "switch",
    "uninstall",
    "update",
    "upgrade",
    "rm",
    "mv",
    "cp",
    "chmod",
    "chown",
    "tee",
    "sed",
    "perl",
    "touch",
}
READ_ONLY_COMMANDS = {
    "audit",
    "cat",
    "check",
    "diff",
    "doctor",
    "env",
    "find",
    "info",
    "list",
    "log",
    "outdated",
    "show",
    "status",
    "version",
}
COMMAND_PREFIXES = {"sudo", "command", "builtin", "exec"}
SHELL_OPERATORS = {">", ">>", "<", "|", "||", "&&", ";", "&"}
PLACEHOLDER_VALUES = {"", "todo", "tbd", "unknown", "fill-me", "placeholder", "n/a"}


class GateError(Exception):
    """Expected gate denial or malformed input."""


def fail(message: str) -> NoReturn:
    raise GateError(message)


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or value.strip().lower() in PLACEHOLDER_VALUES:
        fail(f"{field} must be a non-placeholder non-empty string")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def report_digest(report: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(report)).hexdigest()


def _validate_source(value: Any, field: str) -> str:
    source = _nonempty_string(value, field)
    parsed = urlparse(source)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        fail(f"{field} must be an official HTTPS URL")
    return source


def _validate_action(action: Any, index: int) -> dict[str, Any]:
    if not isinstance(action, dict) or set(action) != ACTION_KEYS:
        fail(f"actions[{index}] must contain exactly cwd, tool_name, and tool_input")
    cwd = _nonempty_string(action["cwd"], f"actions[{index}].cwd")
    if not Path(cwd).is_absolute():
        fail(f"actions[{index}].cwd must be absolute")
    tool_name = _normalize_tool_name(action["tool_name"])
    tool_input = _normalize_tool_input(tool_name, action["tool_input"])
    candidate = {"cwd": cwd, "tool_name": tool_name, "tool_input": tool_input}
    requires, _, _ = classify_payload(candidate)
    if not requires:
        fail(f"actions[{index}] must describe an update requiring approval")
    return candidate


def _validate_report(report: Any) -> dict[str, Any]:
    if not isinstance(report, dict) or set(report) != REPORT_KEYS:
        fail("report must contain exactly id, classification, components, impact, verification_plan, rollback_plan, and actions")
    _nonempty_string(report["id"], "id")
    classification = report["classification"]
    if not isinstance(classification, str) or classification not in REPORT_CLASSIFICATIONS:
        fail(f"classification must be one of {sorted(REPORT_CLASSIFICATIONS)}")

    components = report["components"]
    if not isinstance(components, list) or not components:
        fail("components must be a non-empty list")
    checked_components = []
    for index, component in enumerate(components):
        if not isinstance(component, dict) or set(component) != COMPONENT_KEYS:
            fail(f"components[{index}] has an invalid schema")
        checked_components.append(
            {
                "name": _nonempty_string(component["name"], f"components[{index}].name"),
                "from": _nonempty_string(component["from"], f"components[{index}].from"),
                "to": _nonempty_string(component["to"], f"components[{index}].to"),
                "sources": [
                    _validate_source(source, f"components[{index}].sources[{source_index}]")
                    for source_index, source in enumerate(component["sources"])
                ]
                if isinstance(component["sources"], list) and component["sources"]
                else fail(f"components[{index}].sources must be a non-empty list"),
                "security": _nonempty_string(component["security"], f"components[{index}].security"),
                "non_security": _nonempty_string(component["non_security"], f"components[{index}].non_security"),
            },
        )

    impact = report["impact"]
    if not isinstance(impact, dict) or set(impact) != IMPACT_KEYS:
        fail(f"impact must contain exactly {sorted(IMPACT_KEYS)}")
    checked_impact = {key: _nonempty_string(impact[key], f"impact.{key}") for key in sorted(IMPACT_KEYS)}

    verification = report["verification_plan"]
    if not isinstance(verification, list) or not verification:
        fail("verification_plan must be a non-empty list")
    checked_verification = [_nonempty_string(item, f"verification_plan[{index}]") for index, item in enumerate(verification)]
    rollback = _nonempty_string(report["rollback_plan"], "rollback_plan")

    actions = report["actions"]
    if not isinstance(actions, list) or not actions:
        fail("actions must be a non-empty list")
    checked_actions = [_validate_action(action, index) for index, action in enumerate(actions)]
    return {
        "id": report["id"],
        "classification": classification,
        "components": checked_components,
        "impact": checked_impact,
        "verification_plan": checked_verification,
        "rollback_plan": rollback,
        "actions": checked_actions,
    }


def load_report(path: str | Path) -> tuple[dict[str, Any], str, Path]:
    report_path = Path(path).expanduser()
    if not report_path.is_absolute():
        report_path = report_path.resolve()
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        message = f"cannot read report: {report_path}"
        raise GateError(message) from exc
    checked = _validate_report(report)
    return checked, report_digest(checked), report_path


def _normalize_tool_name(value: Any) -> str:
    if not isinstance(value, str) or value not in TOOL_ALIASES:
        fail("tool_name must be Bash, Edit, Write, or apply_patch")
    return TOOL_ALIASES[value]


def _normalize_tool_input(tool_name: str, tool_input: Any) -> dict[str, Any]:
    if not isinstance(tool_input, dict):
        fail(f"{tool_name} tool_input must be an object")
    if tool_name in {"Bash", "apply_patch"}:
        if set(tool_input) != {"command"} or not isinstance(tool_input["command"], str) or not tool_input["command"].strip():
            fail(f"{tool_name} report actions require exactly {{command}}")
        return {"command": tool_input["command"]}
    return tool_input


def _tool_input_text(tool_input: Any) -> str:
    if isinstance(tool_input, str):
        return tool_input
    if isinstance(tool_input, dict):
        for key in ("command", "cmd", "script", "content", "patch"):
            value = tool_input.get(key)
            if isinstance(value, str):
                return value
    return ""


def _path_from_input(tool_name: str, tool_input: Any) -> list[str]:
    if isinstance(tool_input, str):
        if tool_name == "apply_patch":
            return re.findall(r"^\*\*\* (?:Update|Add|Delete) File: (.+)$", tool_input, re.MULTILINE) + re.findall(r"^\*\*\* Move to: (.+)$", tool_input, re.MULTILINE)
        return []
    if not isinstance(tool_input, dict):
        return []
    paths = []
    if tool_name == "apply_patch":
        patch_text = tool_input.get("command") or tool_input.get("patch")
        if isinstance(patch_text, str):
            paths.extend(re.findall(r"^\*\*\* (?:Update|Add|Delete) File: (.+)$", patch_text, re.MULTILINE))
            paths.extend(re.findall(r"^\*\*\* Move to: (.+)$", patch_text, re.MULTILINE))
    for key in ("path", "file_path", "filePath", "target_file", "filename"):
        value = tool_input.get(key)
        if isinstance(value, str):
            paths.append(value)
    for key in ("edits", "replacements"):
        entries = tool_input.get(key)
        if isinstance(entries, list):
            for entry in entries:
                if isinstance(entry, dict):
                    for path_key in ("path", "file_path", "filePath", "target_file", "filename"):
                        value = entry.get(path_key)
                        if isinstance(value, str):
                            paths.append(value)
    return paths


def _is_protected_path(path: str, cwd: str) -> bool:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = Path(cwd) / candidate
    normalized = str(candidate).replace("\\", "/")
    basename = candidate.name
    if basename in PROTECTED_BASENAMES or basename.startswith("requirements"):
        return True
    if basename.startswith("Dockerfile") or basename.endswith((".lock", ".lockb")):
        return True
    return normalized.endswith("/odoo") or any(part in normalized for part in PROTECTED_PATH_PARTS)


def _nested_shell_command(tokens: list[str]) -> str | None:
    for index, token in enumerate(tokens[:-1]):
        if token in {"bash", "sh", "zsh", "shell"} and tokens[index + 1] in {"-c", "-lc", "-ic"}:
            if index + 2 < len(tokens):
                return tokens[index + 2]
    return None


def _tokenize(command: str) -> list[str]:
    if not isinstance(command, str) or not command.strip():
        fail("Bash tool_input must contain a non-empty command")
    try:
        # Preserve command boundaries after comments. Flattening newlines before
        # lexing makes '# comment\nnpm update' one comment and silently allows it.
        cleaned = []
        quote = None
        escaped = False
        comment = False
        previous = " "
        for char in command:
            if comment:
                if char == "\n":
                    cleaned.append(" ; ")
                    comment = False
                    previous = " "
                continue
            if escaped:
                # A backslash-newline is a shell continuation, not a separator.
                if char == "\n" and quote != "'":
                    cleaned.pop()
                else:
                    cleaned.append(char)
                escaped = False
            elif char == "\\" and quote != "'":
                cleaned.append(char)
                escaped = True
            elif quote:
                cleaned.append(char)
                if char == quote:
                    quote = None
            elif char in {"'", '"'}:
                quote = char
                cleaned.append(char)
            elif char == "#" and (previous.isspace() or previous in ";&|()<>"):
                comment = True
            elif char == "\n":
                cleaned.append(" ; ")
            else:
                cleaned.append(char)
            previous = char
        lexer = shlex.shlex("".join(cleaned), posix=True, punctuation_chars=";&|<>")
        lexer.commenters = ""
        lexer.whitespace_split = True
        return list(lexer)
    except ValueError as exc:
        message = "malformed shell command"
        raise GateError(message) from exc


def _split_command_segments(tokens: list[str]) -> list[list[str]]:
    segments: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token in SHELL_OPERATORS:
            if current:
                segments.append(current)
                current = []
        else:
            current.append(token)
    if current:
        segments.append(current)
    return segments


def _command_name(tokens: list[str]) -> str:
    index = 0
    while index < len(tokens) and tokens[index] in COMMAND_PREFIXES:
        index += 1
    while index < len(tokens) and "=" in tokens[index] and not tokens[index].startswith(("./", "/")):
        index += 1
    if index < len(tokens) and tokens[index] == "env":
        index += 1
        while index < len(tokens):
            token = tokens[index]
            if "=" in token and not token.startswith("-"):
                index += 1
                continue
            if token in {"-i", "--ignore-environment"}:
                index += 1
                continue
            if token == "-u":
                index += 2
                continue
            if token.startswith(("-u", "--unset=")):
                index += 1
                continue
            break
    if index < len(tokens) and tokens[index] == "cd":
        try:
            index = tokens.index("&&", index) + 1
        except ValueError:
            return "cd"
    return Path(tokens[index]).name if index < len(tokens) else ""


def _is_frozen_replay(tokens: list[str]) -> bool:
    return tokens == ["npm", "ci", "--ignore-scripts"]


def _package_operations(tokens: list[str]) -> set[str]:
    operations = set()
    skip_value = False
    for token in tokens[1:]:
        lower = token.lower()
        if skip_value:
            skip_value = False
            continue
        if lower in {"-w", "--workspace", "--prefix", "--cwd", "--filter"}:
            skip_value = True
            continue
        if lower.startswith("-"):
            continue
        operations.add(lower)
    return operations


def _command_args(tokens: list[str], command_name: str) -> list[str]:
    for index, token in enumerate(tokens):
        if Path(token).name == command_name:
            return tokens[index + 1 :]
    return tokens


def _is_odoo_command(tokens: list[str], command_name: str) -> bool:
    if command_name in {"odoo", "odoo-bin", "odoo_secure.py"}:
        return True
    if command_name in {"python", "python3"}:
        if "-m" in tokens:
            try:
                if tokens[tokens.index("-m") + 1] in {"odoo", "odoo.cli"}:
                    return True
            except IndexError:
                return False
        return any(Path(token).name in {"odoo-bin", "odoo_secure.py"} for token in tokens)
    return False


def _classify_bash_segment(tokens: list[str], cwd: str) -> tuple[bool, str]:
    nested = _nested_shell_command(tokens)
    if nested is not None:
        return _classify_bash(nested, cwd)
    if any(token in {"eval", "base64", "openssl", "python", "python3", "perl", "ruby"} for token in tokens[:3]) and "-c" in tokens:
        return True, "opaque dynamic shell execution requires approval"
    command_name = _command_name(tokens)
    lower = [token.lower() for token in tokens]
    if command_name == "npx" and "--no-install" not in tokens:
        return True, "npx execution may fetch or regenerate vendor content"
    if command_name in {"npm", "pnpm", "yarn", "bun"}:
        operations = _package_operations([command_name, *_command_args(tokens, command_name)])
        if command_name == "yarn" and not operations:
            return True, "bare yarn resolves dependencies"
        scripted_update = any(
            operation.endswith((":update", ":upgrade", ":install", ":add"))
            or operation in {"update", "upgrade", "install", "add", "deps:update", "deps:upgrade"}
            for operation in operations
        )
        if operations & {"install", "i", "ci", "add", "update", "up", "upgrade", "remove", "rm", "uninstall", "fix", "exec", "dlx"} or scripted_update:
            if _is_frozen_replay(tokens):
                return False, "frozen npm replay"
            return True, "package dependency change requires an approved report"
        if "audit" in operations and ("fix" in lower or "--fix" in lower):
            return True, "package audit fix requires an approved report"
        if operations & {"audit", "outdated", "list", "ls", "view", "info"}:
            return False, "read-only package audit"
        if _is_frozen_replay(tokens):
            return False, "frozen npm replay"
        if "--save" in lower:
            return True, "package dependency change requires an approved report"
    if command_name in {"pip", "pip3"}:
        args = [token.lower() for token in _command_args(tokens, command_name)]
        if any(operation in args for operation in ("install", "uninstall", "download")):
            return True, "Python dependency change requires an approved report"
    if command_name in {"python", "python3"} and "-m" in tokens:
        try:
            module = lower[tokens.index("-m") + 1]
        except IndexError:
            module = ""
        if module in {"pip", "uv", "poetry"} and any(op in lower for op in ("install", "sync", "add", "update", "upgrade", "uninstall")):
            return True, "Python dependency change requires an approved report"
    if command_name == "uv":
        args = [token.lower() for token in _command_args(tokens, command_name)]
        if any(op in args for op in ("sync", "add", "remove", "install", "uninstall", "download", "upgrade", "update", "lock")):
            return True, "uv dependency change requires an approved report"
    if command_name in {"uvx", "corepack"}:
        return True, "toolchain or transient tool resolution requires approval"
    if command_name == "poetry" and any(op in _command_args(tokens, command_name) for op in ("update", "add", "remove", "install")):
        return True, "Poetry dependency change requires an approved report"
    if command_name in {"brew", "apt", "apt-get"} and any(op in lower for op in ("upgrade", "install", "dist-upgrade", "full-upgrade")):
        return True, "system package change requires an approved report"
    if command_name == "git":
        if "pull" in lower or ("submodule" in lower and "update" in lower):
            return True, "Git update operation requires an approved report"
        if any(op in lower for op in ("checkout", "reset", "switch", "apply")):
            protected = _is_protected_path(cwd, cwd) or any(_is_protected_path(token, cwd) for token in tokens)
            if protected:
                return True, "Git Odoo/vendor operation requires an approved report"
            return False, "ordinary repository branch operation"
    if command_name == "docker":
        if "pull" in lower or "build" in lower or "up" in lower:
            return True, "container image or build change requires an approved report"
        if "compose" in lower:
            return False, "read-only container inspection"
    if _is_odoo_command(tokens, command_name) and any(
        token in {"-u", "--update", "-i", "--init", "button_immediate_upgrade"}
        or token.startswith(("--update=", "--init="))
        or (token.startswith("-u") and token != "-u" and not token.startswith("--"))
        or (token.startswith("-i") and token != "-i" and not token.startswith("--"))
        for token in lower
    ):
        return True, "Odoo module or ORM upgrade requires an approved report"
    if "button_immediate_upgrade" in " ".join(tokens).lower() and "-c" in tokens:
        return True, "ORM upgrade expression requires an approved report"
    if any(operator in tokens for operator in SHELL_OPERATORS) and any(
        token in {"npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv", "poetry", "brew", "apt", "apt-get", "docker", "git"}
        for token in lower
    ) and any(token in MUTATING_COMMANDS for token in lower):
        return True, "compound update command requires an approved report"
    mutation = command_name in MUTATING_COMMANDS
    if command_name in {"sed", "perl"}:
        mutation = any(token == "--in-place" or token.startswith("-i") for token in tokens[1:])
    protected_text = any(_is_protected_path(token, cwd) for token in tokens)
    if protected_text and mutation:
        return True, "protected dependency or vendor path is being mutated"
    if any(token in SHELL_OPERATORS for token in tokens) and protected_text and command_name not in READ_ONLY_COMMANDS:
        return True, "shell mutation involving a protected path requires approval"
    return False, "read-only or ordinary command"


def _classify_bash(command: str, cwd: str) -> tuple[bool, str]:
    tokens = _tokenize(command)
    decisions: list[tuple[bool, str]] = []
    current_cwd = cwd
    for segment in _split_command_segments(tokens):
        if segment and _command_name(segment) == "cd" and len(segment) > 1:
            target = Path(segment[1])
            current_cwd = str(target if target.is_absolute() else Path(current_cwd) / target)
            decisions.append((False, "directory change"))
            continue
        decisions.append(_classify_bash_segment(segment, current_cwd))
    for requires, reason in decisions:
        if requires:
            return requires, reason
    for index, token in enumerate(tokens[:-1]):
        if ">" in token and token in SHELL_OPERATORS and _is_protected_path(tokens[index + 1], current_cwd):
            return True, "shell mutation involving a protected path requires approval"
    return False, decisions[-1][1] if decisions else "read-only or ordinary command"


def classify_payload(payload: Any) -> tuple[bool, str, dict[str, Any]]:
    if not isinstance(payload, dict) or set(payload) != {"tool_name", "tool_input", "cwd"}:
        fail("payload must contain exactly tool_name, tool_input, and cwd")
    cwd = _nonempty_string(payload["cwd"], "cwd")
    if not Path(cwd).is_absolute():
        fail("cwd must be absolute")
    tool_name = _normalize_tool_name(payload["tool_name"])
    tool_input = payload["tool_input"]
    if tool_name == "Bash":
        requires, reason = _classify_bash(_tool_input_text(tool_input), cwd)
    else:
        if not isinstance(tool_input, dict):
            fail(f"{tool_name} tool_input must be an object")
        paths = _path_from_input(tool_name, tool_input)
        if not paths:
            fail(f"{tool_name} tool_input must identify a target path")
        protected = any(_is_protected_path(path, cwd) for path in paths)
        requires = protected
        reason = "protected dependency or vendor file edit" if protected else "ordinary application file edit"
    normalized = {"cwd": cwd, "tool_name": tool_name, "tool_input": tool_input}
    return requires, reason, normalized


def _action_matches(action: dict[str, Any], normalized: dict[str, Any]) -> bool:
    return canonical_json(action) == canonical_json(normalized)


def _state_path(state_dir: Path) -> Path:
    return state_dir / "approved.json"


@contextmanager
def _state_lock(state_path: Path) -> Iterator[None]:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = state_path.with_name(state_path.name + ".lock")
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        if fcntl is not None:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
            json.dump(value, temp_file, ensure_ascii=False, sort_keys=True, indent=2)
            temp_file.write("\n")
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def _read_state(path: Path) -> dict[str, Any]:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        message = "approval state is missing or malformed"
        raise GateError(message) from exc
    if not isinstance(state, dict) or set(state) != {"report_path", "digest", "index", "expires"}:
        fail("approval state schema is invalid")
    if not isinstance(state["report_path"], str) or not isinstance(state["digest"], str) or not isinstance(state["index"], int) or not isinstance(state["expires"], (int, float)):
        fail("approval state values are invalid")
    return state


def consume_approval(payload: dict[str, Any], state_dir: Path) -> tuple[bool, str]:
    requires, reason, normalized = classify_payload(payload)
    if not requires:
        return True, reason
    state_path = _state_path(state_dir)
    if not state_path.is_file():
        return False, reason + "; no approval exists"
    with _state_lock(state_path):
        state = _read_state(state_path)
        if float(state["expires"]) <= time.time():
            return False, "approval is expired"
        report, digest, report_path = load_report(state["report_path"])
        if digest != state["digest"]:
            return False, "report changed after approval"
        index = state["index"]
        actions = report["actions"]
        if index < 0 or index >= len(actions):
            return False, "approval actions are exhausted"
        if not _action_matches(actions[index], normalized):
            return False, f"action does not match approved action {index}"
        state["index"] = index + 1
        _atomic_write_json(state_path, state)
    return True, f"approved action {index} from {report_path}"


def _print_decision(allowed: bool, reason: str) -> int:
    if allowed:
        print(json.dumps({"decision": "allow", "reason": reason}, ensure_ascii=False))
        return 0
    print(f"update gate denied: {reason}", file=sys.stderr)
    return 2


def command_check(state_dir: Path) -> int:
    try:
        payload = json.loads(sys.stdin.read())
        allowed, reason = consume_approval(payload, state_dir)
    except (GateError, json.JSONDecodeError) as exc:
        return _print_decision(False, str(exc))
    return _print_decision(allowed, reason)


def command_validate(report_path: str) -> int:
    try:
        report, digest, path = load_report(report_path)
    except GateError as exc:
        print(f"update gate denied: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"valid": True, "report_path": str(path), "digest": digest, "report": report}, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


def command_approve(report_path: str, state_dir: Path) -> int:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print("update gate denied: approve requires a human interactive terminal", file=sys.stderr)
        return 2
    try:
        report, digest, path = load_report(report_path)
    except GateError as exc:
        print(f"update gate denied: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    print(f"Report SHA-256: {digest}")
    try:
        answer = input(f"Type 'approve {digest}' to approve this report: ")
    except EOFError:
        print("update gate denied: approval confirmation was not entered", file=sys.stderr)
        return 2
    if answer.strip() != f"approve {digest}":
        print("update gate denied: approval confirmation did not match the report digest", file=sys.stderr)
        return 2
    state = {
        "report_path": str(path),
        "digest": digest,
        "index": 0,
        "expires": time.time() + 3600,
    }
    state_path = _state_path(state_dir)
    with _state_lock(state_path):
        _atomic_write_json(state_path, state)
    print(f"approval stored for {path}; expires in one hour")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Human approval gate for dependency, vendor, and runtime updates")
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("check",):
        subparsers.add_parser(command)
    for command in ("approve", "validate"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("report")
        subparser.add_argument("--state-dir", type=Path, default=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    state_dir = args.state_dir or DEFAULT_STATE_DIR
    if args.command == "check":
        return command_check(state_dir)
    if args.command == "validate":
        return command_validate(args.report)
    return command_approve(args.report, state_dir)


if __name__ == "__main__":
    raise SystemExit(main())
