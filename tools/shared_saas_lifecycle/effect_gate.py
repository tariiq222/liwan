"""The only entry to the shared SaaS lifecycle effects (docker boundary).

The control-plane worker has no docker access. systemd starts this gate once per connection as the
`liwan-effect` account with the socket as stdin and stdout; local stacks and tests spawn it directly with
pipes. One wire protocol either way, JSON lines:

    in   line 1  {"effect": "<name>"}      name from EFFECTS
    in   line 2  the effect request, at most MAX_REQUEST bytes, without a `config` field, matching the effect's schema
             in effect_schema.py (known keys only, strict identifier patterns; refusal code `request_invalid`)
    in   later   lines the effect reads itself, such as {"proceed": true}; the peer keeps the connection open
    out  lines   the effect's own lines, relayed unchanged
    out  last    {"exit": <code>}          a socket carries no exit status

The gate reads `config` from the file named by its own LIWAN_SHARED_RUNTIME_CONFIG, so the worker never
chooses the compose file. A refusal is `{"error_code": <code>}` followed by `{"exit": 2}`; it never echoes the
request, the config or an environment value. When the peer hangs up (stdin EOF before the effect finishes, or an
output write fails) or the gate gets SIGTERM, the effect's process group gets SIGTERM, then SIGKILL after the grace.
"""
from __future__ import annotations

import json
import os
import select
import signal
import stat
import subprocess
import sys
import threading
import time

from tools.shared_saas_lifecycle.effect_schema import SchemaError, validate

EFFECTS = {name: 'tools.shared_saas_lifecycle.' + name for name in (
    'odoo_effect', 'odoo_backup', 'subscription_effect', 'admin_password_effect', 'tenant_status_effect', 'tenant_drop_effect')}

MAX_REQUEST = 65536
MAX_HEAD_LINE = 1024
MAX_CONFIG = 65536
HEAD_TIMEOUT = 30
KILL_GRACE = 20
REFUSED_EXIT = 2
CONFIG_ENV = 'LIWAN_SHARED_RUNTIME_CONFIG'
DELETION_ENV = 'LIWAN_TENANT_DELETION_ENABLED'
DROP_EFFECT = 'tenant_drop_effect'
# The effects need exactly these; the gate's other variables (the runtime config path, the deletion flag, secrets) stay behind.
CHILD_ENV = ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG',
             'LIWAN_RELEASE_ROUTES_DIR', 'LIWAN_RELEASE_HELPER_POOL_ID')
DEFAULT_PATH = '/usr/bin:/bin'
EFFECT_STATE_DIRS = ('reservations', 'credentials', 'classifications', 'restore-effects', 'reconfigure',
                     'runtime-gate-history', 'backups')


class Refusal(Exception):
    """A refusal carries only a non-secret code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


class LineReader:
    """Reads lines from a descriptor and keeps the bytes after them, so the later lines reach the effect."""

    def __init__(self, fd, timeout):
        self.fd, self.timeout, self.buffer = fd, timeout, b''

    def line(self, limit):
        deadline = time.monotonic() + self.timeout
        while True:
            end = self.buffer.find(b'\n')
            if end >= 0:
                if end > limit:
                    raise Refusal('request_invalid')
                line, self.buffer = self.buffer[:end], self.buffer[end + 1:]
                return line
            if len(self.buffer) > limit:
                raise Refusal('request_invalid')
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.fd], [], [], remaining)[0]:
                raise Refusal('request_invalid')
            chunk = os.read(self.fd, MAX_REQUEST + 1)
            if not chunk:
                raise Refusal('request_invalid')
            self.buffer += chunk


def parse_effect(raw, effects):
    try:
        head = json.loads(raw)
    except ValueError:
        raise Refusal('request_invalid') from None
    if not isinstance(head, dict) or set(head) != {'effect'} or not isinstance(head['effect'], str):
        raise Refusal('request_invalid')
    if head['effect'] not in effects:
        raise Refusal('effect_unknown')
    return head['effect']


def parse_request(raw):
    try:
        request = json.loads(raw)
    except ValueError:
        raise Refusal('request_invalid') from None
    if not isinstance(request, dict):
        raise Refusal('request_invalid')
    if 'config' in request:
        raise Refusal('config_forbidden')
    return request


# ---- trust rule ---------------------------------------------------------------------------------------------------


def _owned(info, euid):
    return info.st_uid in (0, euid)


def _group_other_writable(info):
    return bool(info.st_mode & (stat.S_IWGRP | stat.S_IWOTH))


def _stat(path, lstat):
    try:
        return lstat(path)
    except OSError:
        raise Refusal('runtime_untrusted') from None


def _ancestors(path):
    parts = path.split('/')[1:-1]
    return ['/'] + ['/' + '/'.join(parts[:i]) for i in range(1, len(parts) + 1)]


def check_file(path, euid, lstat=os.lstat):
    """A root-or-euid owned regular file under root-or-euid owned directories, none writable by group or other."""
    if not isinstance(path, str) or not path.startswith('/') or os.path.normpath(path) != path:
        raise Refusal('runtime_untrusted')
    for directory in _ancestors(path):
        info = _stat(directory, lstat)
        if not stat.S_ISDIR(info.st_mode) or not _owned(info, euid) or _group_other_writable(info):
            raise Refusal('runtime_untrusted')
    info = _stat(path, lstat)
    if not stat.S_ISREG(info.st_mode) or not _owned(info, euid) or _group_other_writable(info):
        raise Refusal('runtime_untrusted')


def check_state_dir(path, euid, lstat=os.lstat):
    """Ancestors as for a file. The directory may be group-writable only with the sticky bit; its effect
    subdirectories, where they exist, belong to the gate's own account and are writable by it alone (group and
    other may read: `backups` is 0750 so the worker can read manifests, `classifications` 0755 for the containers)."""
    if not isinstance(path, str) or not path.startswith('/') or os.path.normpath(path) != path:
        raise Refusal('runtime_untrusted')
    for directory in _ancestors(path):
        info = _stat(directory, lstat)
        if not stat.S_ISDIR(info.st_mode) or not _owned(info, euid) or _group_other_writable(info):
            raise Refusal('runtime_untrusted')
    info = _stat(path, lstat)
    mode = info.st_mode
    if (not stat.S_ISDIR(mode) or not _owned(info, euid) or mode & stat.S_IWOTH
            or (mode & stat.S_IWGRP and not mode & stat.S_ISVTX)):
        raise Refusal('runtime_untrusted')
    for name in EFFECT_STATE_DIRS:
        try:
            sub = lstat(path + '/' + name)
        except FileNotFoundError:
            continue
        except OSError:
            raise Refusal('runtime_untrusted') from None
        if not stat.S_ISDIR(sub.st_mode) or sub.st_uid != euid or _group_other_writable(sub):
            raise Refusal('runtime_untrusted')


def load_config(env, euid, effect, lstat=os.lstat):
    """The runtime config from the gate's own file, after the trust rule on every path the effect will use."""
    path = env.get(CONFIG_ENV)
    if not path:
        raise Refusal('runtime_unconfigured')
    check_file(path, euid, lstat)
    try:
        with open(path, 'rb') as handle:
            raw = handle.read(MAX_CONFIG + 1)
        config = json.loads(raw) if len(raw) <= MAX_CONFIG else None
    except (OSError, ValueError):
        raise Refusal('runtime_invalid') from None
    if not isinstance(config, dict) or not all(isinstance(config.get(key), str) for key in ('composeFile', 'envFile', 'stateDir')):
        raise Refusal('runtime_invalid')
    if effect == DROP_EFFECT:
        config.pop('releaseBackupConfig', None)
    check_file(config['composeFile'], euid, lstat)
    check_file(config['envFile'], euid, lstat)
    check_state_dir(config['stateDir'], euid, lstat)
    return config


def check_request_schema(effect, request, validator=validate):
    """Allowed keys, exact types and strict identifier patterns per effect (effect_schema.py), before anything is started."""
    try:
        validator(effect, request)
    except SchemaError:
        raise Refusal('request_invalid') from None


def check_deletion_switch(effect, request, env):
    """A real drop needs the flag in the gate's own unit; a compromised worker cannot supply it. Dry runs never change anything."""
    if effect == DROP_EFFECT and request.get('dryRun') is not True and env.get(DELETION_ENV) != 'true':
        raise Refusal('deletion_disabled')


# ---- supervision --------------------------------------------------------------------------------------------------


def child_env(env):
    out = {name: env[name] for name in CHILD_ENV if env.get(name)}
    out.setdefault('PATH', DEFAULT_PATH)
    out['PYTHONUNBUFFERED'] = '1'
    return out


def child_argv(module):
    return [sys.executable, '-E', '-s', '-B', '-m', module]


def _write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def emit(fd, value):
    _write_all(fd, (json.dumps(value, separators=(',', ':')) + '\n').encode())


def exit_code(returncode):
    return returncode if returncode >= 0 else 128 + -returncode


def stop_group(child, grace):
    """SIGTERM to the whole process group, SIGKILL to it when anything is left after the grace."""
    def group_alive():
        child.poll()
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            return False
        return True

    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace
    while group_alive() and time.monotonic() < deadline:
        time.sleep(0.02)
    if group_alive():
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    child.wait()


def relay(child, reader, in_fd, out_fd, stop, grace):
    """Two-way relay until the effect ends. Returns the effect's exit code, or None when the peer is gone."""
    child_in, child_out = child.stdin.fileno(), child.stdout.fileno()
    pending = b''
    peer_gone = False

    def forward(data):
        try:
            _write_all(child_in, data)
        except OSError:
            pass  # the effect ended; its exit shows on stdout

    if reader.buffer:
        forward(reader.buffer)
        reader.buffer = b''
    watching = [in_fd, child_out]
    while child_out in watching and not stop.is_set() and not peer_gone:
        ready = select.select(watching, [], [], 0.1)[0]
        if in_fd in ready:
            data = os.read(in_fd, 65536)
            if data:
                forward(data)
            else:
                peer_gone = True
        if child_out in ready:
            data = os.read(child_out, 65536)
            if not data:
                watching.remove(child_out)
                continue
            pending += data
            *lines, pending = pending.split(b'\n')
            try:
                for line in lines:
                    _write_all(out_fd, line + b'\n')
            except OSError:
                peer_gone = True
    if peer_gone or stop.is_set():
        stop_group(child, grace)
        if stop.is_set() and not peer_gone:
            return _finish(child, pending, out_fd)
        return None
    return _finish(child, pending, out_fd)


def _finish(child, pending, out_fd):
    try:
        if pending:
            _write_all(out_fd, pending + b'\n')
        child.wait()
        emit(out_fd, {'exit': exit_code(child.returncode)})
    except OSError:
        pass
    return exit_code(child.returncode)


def run(in_fd, out_fd, env, *, stop, effects=EFFECTS, argv=child_argv, grace=KILL_GRACE, head_timeout=HEAD_TIMEOUT,
        euid=None, lstat=os.lstat, validator=validate):
    """One connection. Returns the gate's exit code (the same code its last output line carries)."""
    euid = os.geteuid() if euid is None else euid
    reader = LineReader(in_fd, head_timeout)
    try:
        effect = parse_effect(reader.line(MAX_HEAD_LINE), effects)
        request = parse_request(reader.line(MAX_REQUEST))
        check_request_schema(effect, request, validator)
        check_deletion_switch(effect, request, env)
        request['config'] = load_config(env, euid, effect, lstat)
        try:
            child = subprocess.Popen(argv(effects[effect]), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, env=child_env(env), start_new_session=True)
        except OSError:
            raise Refusal('effect_start_failed') from None
    except Refusal as refusal:
        try:
            emit(out_fd, {'error_code': refusal.code})
            emit(out_fd, {'exit': REFUSED_EXIT})
        except OSError:
            pass
        return REFUSED_EXIT
    try:
        child.stdin.write(json.dumps(request, separators=(',', ':')).encode() + b'\n')
        child.stdin.flush()
    except OSError:
        pass  # the effect ended before reading; its exit shows below
    code = relay(child, reader, in_fd, out_fd, stop, grace)
    for stream in (child.stdin, child.stdout):
        try:
            stream.close()
        except OSError:
            pass
    return REFUSED_EXIT if code is None else code


def main():
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda _signum, _frame: stop.set())
    return run(0, 1, os.environ, stop=stop)


if __name__ == '__main__':
    sys.exit(main())
