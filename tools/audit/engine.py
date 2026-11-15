"""Run one audit stage with a recorded command, timeout and normalized result.

Every stage returns a `{"name", "status", "reason", "checks", "evidence", ...}` mapping the report
can render without interpreting raw tool output. `status` is one of:

- `passed`     the command ran and met its own exit criterion;
- `failed`     the command ran and its exit criterion was not met;
- `not_verified` the stage could not run safely or its prerequisite was absent; `reason` says why;
- `skipped`    the profile did not select it.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AUDIT_DIR = REPO / '.audit'
GENERATED_SKIP = re.compile(
    r'(^|/)(node_modules|\.nuxt|\.output|\.nitro|storybook-static|dist|coverage|test-results|\.git|\.worktrees|\.audit)'
    r'(/|$)|(^|/)vendor(/|$)'
)


class StageError(RuntimeError):
    """A stage definition is wrong; this is a framework bug, not a finding."""


@dataclass
class Command:
    """One command a stage runs. `check` decides which nonzero exits are still an acceptable result."""
    name: str
    argv: list[str]
    cwd: Path = field(default_factory=lambda: REPO)
    timeout: int = 600
    env: dict = field(default_factory=dict)
    allow_exit: tuple = (0,)
    evidence: str = ''
    needs: str = ''


def executable(name):
    return shutil.which(name)


def run_command(command: Command, log_dir: Path):
    """Run a command and return its recorded result; never raises for a tool's own failure."""
    log_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r'[^a-z0-9]+', '-', command.name.lower()).strip('-') or 'command'
    log = log_dir / f'{slug}.log'
    started = time.time()
    detail = {'name': command.name, 'argv': command.argv, 'cwd': str(command.cwd), 'log': str(log)}
    if command.needs and not executable(command.needs):
        detail.update(status='not_verified', reason=f'{command.needs} is not installed', seconds=0.0)
        return detail
    allowed = set(command.allow_exit)
    try:
        with log.open('wb') as handle:
            result = subprocess.run(
                command.argv, cwd=command.cwd, stdout=handle, stderr=subprocess.STDOUT,
                timeout=command.timeout, env={**os.environ, **command.env}, check=False,
            )
    except FileNotFoundError:
        detail.update(status='not_verified', reason=f'{command.argv[0]} is not installed', seconds=0.0)
        return detail
    except subprocess.TimeoutExpired:
        detail.update(status='failed', reason=f'timed out after {command.timeout}s', seconds=time.time() - started)
        return detail
    detail.update(status='passed' if result.returncode in allowed else 'failed',
                  exit_code=result.returncode, seconds=round(time.time() - started, 2))
    if result.returncode not in allowed:
        detail['reason'] = f'exit code {result.returncode}'
    detail['tail'] = tail(log)
    if result.returncode not in allowed and crashed(log):
        detail['status'] = 'not_verified'
        detail['reason'] = f'{command.name} crashed before producing a result (exit {result.returncode})'
    return detail


# A tool that aborts on startup (missing trust store, unreachable registry, unreadable cache) exits
# nonzero without scanning anything. Recording that as a failed check turns a broken environment into a
# code finding, so the crash is a Not Verified probe with the tool's own message instead.
CRASH_MARKERS = (
    'Fatal error: exception',
    'ENOTFOUND',
    'getaddrinfo',
    'Could not resolve host',
    'command not found',
    'No such file or directory',
    'empty trust anchors',
    'Permission denied',
)


def crashed(log: Path) -> bool:
    """True when the log shows the tool never reached the scan, so its exit code is not a verdict."""
    try:
        text = log.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return False
    return any(marker in text for marker in CRASH_MARKERS)

def tail(path: Path, lines: int = 12) -> str:
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return ''
    return '\n'.join(text.splitlines()[-lines:])


def stage(name, commands, evidence=None):
    """A stage's result from its commands. Evidence is attached only when every required command passed."""
    checks = [run_command(command, AUDIT_DIR / 'logs' / name) for command in commands]
    failed = [check for check in checks if check['status'] == 'failed']
    unavailable = [check for check in checks if check['status'] == 'not_verified']
    if failed:
        status = 'failed'
        reason = '; '.join(f"{check['name']}: {check.get('reason', 'failed')}" for check in failed)
    elif unavailable and len(unavailable) == len(checks):
        status = 'not_verified'
        reason = '; '.join(f"{check['name']}: {check['reason']}" for check in unavailable)
    else:
        status = 'passed'
        reason = '' if not unavailable else '; '.join(
            f"{check['name']}: {check['reason']}" for check in unavailable)
    return {'name': name, 'status': status, 'reason': reason, 'checks': checks,
            'evidence': evidence if evidence is not None and status != 'failed' else {}}


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default
