"""Shared plumbing of the release command: errors, command runner, state files, lock and the redacting log."""
from __future__ import annotations

import fcntl
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

EXIT_OK, EXIT_REFUSED, EXIT_HALTED, EXIT_FAILED, EXIT_ROLLBACK_FAILED = 0, 2, 3, 4, 5
FAILURE_TAIL_LINES = 5
TIMED_OUT = 124  # the exit code of a command killed for running past its timeout, as coreutils timeout(1) reports it


class ReleaseError(Exception):
    """A stop with a closed reason code (``^[a-z][a-z0-9_]{0,63}$``) that alerts and the RESULT line may carry."""

    def __init__(self, reason: str, exit_code: int = EXIT_FAILED, detail: str = ''):
        super().__init__(reason)
        self.reason = reason
        self.exit_code = exit_code
        self.detail = detail


class CommandFailed(Exception):
    def __init__(self, argv: list[str], returncode: int):
        super().__init__(f'{argv[0]} exited {returncode}')
        self.returncode = returncode


class Runner:
    """Runs one command, logs its argv (never its environment or stdin), returns the exit code and combined output.

    A failed checked command logs the last lines of its output; the log redacts every known secret. A command given a
    ``timeout`` (seconds) is killed when it runs longer and counts as failed with ``TIMED_OUT``.
    """

    def __init__(self, log):
        self.log = log

    def __call__(self, argv: list[str], *, stdin: str | None = None, env: dict | None = None,
                 check: bool = True, timeout: float | None = None,
                 cwd: Path | None = None) -> tuple[int, str]:
        self.log('$ ' + ' '.join(argv))
        try:
            done = subprocess.run(argv, input=stdin, env=env, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, check=False, timeout=timeout, cwd=cwd)
        except subprocess.TimeoutExpired as expired:  # subprocess.run has already killed and reaped the child
            self.log(f'  timed out after {timeout} seconds')
            partial = expired.output  # bytes even with text=True, None when nothing was read
            if isinstance(partial, bytes):
                partial = partial.decode('utf-8', errors='replace')
            done = subprocess.CompletedProcess(argv, TIMED_OUT, stdout=partial or '')
        if check and done.returncode != 0:
            for line in done.stdout.splitlines()[-FAILURE_TAIL_LINES:]:
                self.log('  ' + line)
            raise CommandFailed(argv, done.returncode)
        return done.returncode, done.stdout


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def unquote(value: str) -> str:
    """One matching pair of surrounding quotes is syntax, as in a docker compose env file."""
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'' else value


def parse_env_text(text: str) -> dict[str, str]:
    """KEY=VALUE lines of an env file: blank lines and ``#`` comments skipped, one pair of quotes around a value removed."""
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = unquote(value.strip())
    return values


def read_env_file(path: Path) -> dict[str, str]:
    return parse_env_text(path.read_text(encoding='utf-8'))


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with open(temporary, 'w', encoding='utf-8') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def write_json(path: Path, value: dict) -> None:
    write_atomic(path, json.dumps(value, indent=2, sort_keys=True) + '\n')


def read_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def free_bytes(path: str) -> int:
    return shutil.disk_usage(path).free


GROUP_WRITE = stat.S_IWGRP | stat.S_IWOTH
OTHER_READ = stat.S_IROTH
GROUP_READ = stat.S_IRGRP


def unreadable_by_worker(info: os.stat_result) -> bool:
    """A root-owned file that group and others cannot read: the worker account could never read what is copied from it."""
    return info.st_uid == 0 and not info.st_mode & (GROUP_READ | OTHER_READ)


def unsafe_shared_file(info: os.stat_result, owners: set[int], group_readers: set[int] = frozenset()) -> bool:
    """Whether a shared env file is unsafe to read: a stranger owns it, group or other may write it (the release and
    init-host.sh act on the paths it names), other may read it, or a group outside ``group_readers`` may read it.

    Group read is what the documented state needs: 0640 root:docker, because the effect account reads the file through
    the docker group and the worker is not in that group (A4.1). ``group_readers`` is who may be that group.
    ``unreadable_by_worker`` above answers the release's other question, whether a copied file is readable by the worker.
    """
    return (info.st_uid not in owners or bool(info.st_mode & (GROUP_WRITE | OTHER_READ))
            or bool(info.st_mode & GROUP_READ and info.st_gid not in group_readers))


SENSITIVE_KEY = re.compile(r'PASSWORD|SECRET|TOKEN|KEY|PASS|DSN|URL|URI', re.IGNORECASE)
MIN_SECRET_LENGTH = 4  # a shorter value would mask ordinary words in the log


def sensitive_values(*sources: dict[str, str]) -> list[str]:
    """The values of every env-file entry whose key looks like a credential."""
    found = []
    for source in sources:
        for key, value in source.items():
            if not SENSITIVE_KEY.search(key):
                continue
            found.append(value)
            try:
                password = urlsplit(value).password  # a URL value also hides its password on its own
            except ValueError:
                password = None
            if password:
                found.append(password)
    return [value for value in found if len(value) >= MIN_SECRET_LENGTH]


def make_log(secrets: list[str], stream=None):
    """A line logger on stdout (the job log) that replaces every secret value by ``***``.

    ``log.secrets`` is the live list: values learned later (the config files) are appended to it.
    """
    stream = stream or sys.stdout

    def log(message: str) -> None:
        for secret in secrets:
            if secret:
                message = message.replace(secret, '***')
        stream.write(f'{now()} release: {message}\n')
        stream.flush()
    log.secrets = secrets
    return log


class Lock:
    """One run per environment: a non-blocking flock on ``<state>/lock``."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.parent.chmod(0o700)  # the state directory stays private, whatever the release tree's modes
        self.handle = open(path, 'a+', encoding='utf-8')

    def __enter__(self) -> bool:
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True

    def __exit__(self, *_):
        self.handle.close()
