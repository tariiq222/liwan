#!/usr/bin/env python3
"""Host alert for the services of the vendor console: one message when a service turns stale or unavailable, one when it recovers.

Run once a minute by ``liwan-service-health-alert.timer``. It asks the control database directly (``psql``, a read-only role) for
``service_health_states(now())``, the one place the staleness thresholds live, so it works when the control API and the shared
worker are both down, and it cannot disagree with the console. What it already announced is kept in a small state file, so a
service that stays down is announced once, and a message that was not delivered is sent again on the next run.

The monitor is itself watched by this script: when it cannot read the table (database down, ``psql`` missing, credentials or a
timeout) several runs in a row, it announces once that ``health_monitor`` is unavailable, and once when it can read again; a
single transient failure sends nothing. The count of consecutive failures is kept in the state file.

Environment (names only; see ``service-health-alert.env.example``): LIWAN_CONTROL_HEALTH_DB_NAME (required),
LIWAN_CONTROL_HEALTH_PG_HOST / _PG_PORT / _PG_USER / _PSQL (optional), PGPASSFILE (the password; never an argument),
LIWAN_SERVICE_HEALTH_STATE_FILE (or the STATE_DIRECTORY systemd sets), and the LIWAN_ALERT_* channels of ``deploy/alerts.py``.

Exit codes are those of ``alerts.py``: 0 done, 1 an alert or the read failed (retried next run), 2 refused (configuration or data).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import alerts  # noqa: E402

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
    from datetime import datetime

STATE_VERSION = 1
# The component that stands for this monitor in the announcements; it is "down" while the table cannot be read.
MONITOR = 'health_monitor'
# Consecutive failed reads (the timer runs once a minute) before the monitor says it is blind.
READ_FAILURES_BEFORE_ALERT = 3
PSQL_TIMEOUT_SECONDS = 30
COMPONENT = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
DOWN_STATES = frozenset(alerts.SERVICE_STATE_TEXT)
QUERY = ("SELECT coalesce(json_agg(json_build_object('component', component, 'state', state) ORDER BY component), '[]'::json) "
         'FROM service_health_states(now()) WHERE down')


class ConfigError(Exception):
    """The environment does not say where to read or where to remember."""


class ReadError(Exception):
    """The health table could not be read; the message never carries what the database printed."""


class DataError(Exception):
    """The table or the state file holds something this script will not pass on."""


def psql_reader(env: Mapping[str, str], runner=subprocess.run) -> Callable[[], list[dict[str, str]]]:
    database = env.get('LIWAN_CONTROL_HEALTH_DB_NAME', '').strip()
    if not database:
        raise ConfigError('LIWAN_CONTROL_HEALTH_DB_NAME is not set')
    argv = [env.get('LIWAN_CONTROL_HEALTH_PSQL', 'psql'), '--no-psqlrc', '--no-align', '--tuples-only', '--quiet',
            '--no-password', '--set', 'ON_ERROR_STOP=1']
    for flag, name in (('--host', 'LIWAN_CONTROL_HEALTH_PG_HOST'), ('--port', 'LIWAN_CONTROL_HEALTH_PG_PORT'),
                       ('--username', 'LIWAN_CONTROL_HEALTH_PG_USER')):
        if env.get(name, '').strip():
            argv += [flag, env[name].strip()]
    argv += ['--dbname', database, '--command', QUERY]
    child_env = {name: env[name] for name in ('PATH', 'PGPASSFILE', 'PGSSLMODE', 'PGSSLROOTCERT') if name in env}

    def read() -> list[dict[str, str]]:
        try:
            done = runner(argv, env=child_env, capture_output=True, text=True, timeout=PSQL_TIMEOUT_SECONDS, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ReadError(f'the health table could not be read ({type(error).__name__})') from error
        if done.returncode != 0:
            raise ReadError(f'the health table could not be read (psql exit {done.returncode})')
        try:
            rows = json.loads(done.stdout)
        except ValueError as error:
            raise ReadError('the health table could not be read (psql answered text that is not JSON)') from error
        return rows

    return read


@dataclass(frozen=True)
class Memory:
    """What an earlier run left: the components already announced as down, and how many reads in a row have failed."""

    down: dict[str, str] = field(default_factory=dict)
    read_failures: int = 0


class StateFile:
    """The memory between runs. A missing file is an empty memory; a damaged one is refused."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> Memory:
        try:
            text = self.path.read_text(encoding='utf-8')
        except FileNotFoundError:
            return Memory()
        try:
            data = json.loads(text)
            valid = (isinstance(data, dict) and data.get('version') == STATE_VERSION and isinstance(data.get('down'), dict)
                     and all(COMPONENT.fullmatch(c) and s in DOWN_STATES for c, s in data['down'].items())
                     and isinstance(data.get('read_failures'), int) and not isinstance(data['read_failures'], bool)
                     and 0 <= data['read_failures'] <= READ_FAILURES_BEFORE_ALERT)
        except ValueError:
            valid = False
        if not valid:
            raise DataError(f'the state file {self.path} is damaged; fix or remove it')
        return Memory(dict(data['down']), data['read_failures'])

    def save(self, memory: Memory) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=self.path.parent, prefix='.state.')
        try:
            with os.fdopen(handle, 'w', encoding='utf-8') as out:
                json.dump({'version': STATE_VERSION, 'down': dict(sorted(memory.down.items())), 'read_failures': memory.read_failures}, out)
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        except BaseException:
            os.unlink(temporary)
            raise


def _validated(rows: object) -> dict[str, str]:
    if not isinstance(rows, list):
        raise DataError('the health table answered something that is not a list')
    down: dict[str, str] = {}
    for item in rows:
        component = item.get('component') if isinstance(item, dict) else None
        state = item.get('state') if isinstance(item, dict) else None
        if not isinstance(component, str) or not COMPONENT.fullmatch(component) or state not in DOWN_STATES or component in down:
            raise DataError('the health table holds a row this script will not announce')
        down[component] = state
    return down


def _announce_blindness(memory: Memory, alerter: Callable[[list[str]], int], state: StateFile) -> int:
    """One more failed read: count it, and say once that the monitor is blind when the count is reached."""
    failures = min(memory.read_failures + 1, READ_FAILURES_BEFORE_ALERT)
    down = memory.down
    code = alerts.EXIT_OK
    if failures >= READ_FAILURES_BEFORE_ALERT and MONITOR not in down:
        code = alerter(['service_down', '--component', MONITOR, '--state', 'unavailable'])
        if code == alerts.EXIT_OK:
            down = {**down, MONITOR: 'unavailable'}
    state.save(Memory(down, failures))
    return max(code, alerts.EXIT_DELIVERY_FAILED)


def run(reader: Callable[[], list[dict[str, str]]], alerter: Callable[[list[str]], int], state: StateFile) -> int:
    """Announce what changed since the last run; the worst exit code of the run."""
    try:
        memory = state.load()
        remembered = memory.down
        try:
            current = _validated(reader())
        except ReadError as error:
            sys.stderr.write(f'service-health-alert: {error}\n')
            return _announce_blindness(memory, alerter, state)
    except DataError as error:
        sys.stderr.write(f'service-health-alert: {error}\n')
        return alerts.EXIT_REFUSED
    worst = alerts.EXIT_OK
    if memory.read_failures:
        state.save(Memory(remembered))
    for component in sorted(set(current) | set(remembered)):
        if component in current and remembered.get(component) != current[component]:
            argv = ['service_down', '--component', component, '--state', current[component]]
            after = {**remembered, component: current[component]}
        elif component not in current:
            argv = ['service_recovered', '--component', component]
            after = {name: value for name, value in remembered.items() if name != component}
        else:
            continue
        code = alerter(argv)
        if code == alerts.EXIT_OK:
            remembered = after
            state.save(Memory(remembered))
        else:
            worst = max(worst, code)
    return worst


def alerts_main(env: Mapping[str, str], transports: alerts.Transports | None = None, now: datetime | None = None) -> Callable[[list[str]], int]:
    """The real sender: ``deploy/alerts.py`` with this environment's channels."""
    return lambda argv: alerts.main(argv, env=env, transports=transports, now=now)


def main(argv: list[str] | None = None, *, env: Mapping[str, str] | None = None, reader=None, alerter=None) -> int:
    if argv:
        sys.stderr.write('service-health-alert: takes no arguments; it is configured by environment\n')
        return alerts.EXIT_REFUSED
    env = os.environ if env is None else env
    try:
        path = env.get('LIWAN_SERVICE_HEALTH_STATE_FILE', '').strip()
        if not path and env.get('STATE_DIRECTORY', '').strip():
            path = str(Path(env['STATE_DIRECTORY'].split(':')[0]) / 'service-health-alert.json')
        if not path:
            raise ConfigError('LIWAN_SERVICE_HEALTH_STATE_FILE is not set (and there is no systemd STATE_DIRECTORY)')
        reader = reader or psql_reader(env)
    except ConfigError as error:
        sys.stderr.write(f'service-health-alert: {error}\n')
        return alerts.EXIT_REFUSED
    return run(reader, alerter or alerts_main(env), StateFile(Path(path)))


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
