# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bounded POSIX child execution and one-operation local Docker endpoint pinning."""
from __future__ import annotations

import json
import math
import os
import selectors
import signal
import stat
import subprocess
import time
from pathlib import Path

INPUT_LIMIT = 65536
MAX_OUTPUT_LIMIT = 16 * 1024 * 1024
UNAVAILABLE = (124, '', '')
OVERFLOW = (125, '', '')


class ProcessError(Exception):
    """Code-only context refusal: never expose child diagnostics or endpoints."""

    def __init__(self, code):
        allowed = {'docker_context_unavailable', 'docker_context_not_local'}
        self.code = code if isinstance(code, str) and code in allowed else 'docker_context_unavailable'
        super().__init__(self.code)


def _refuse(code='docker_context_unavailable'):
    raise ProcessError(code) from None


def _kill_group(child):
    """Terminate the whole child session, then always reap the direct child.

    POSIX cannot waitpid non-child grandchildren. A short SIGTERM grace lets
    cooperative parents reap theirs; remaining descendants get SIGKILL and
    orphan zombies are reaped by the OS. Descendants that deliberately setsid()
    escape this boundary; this is not an untrusted-code sandbox.
    """
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=0.2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def _valid_args(argv, timeout, output_limit, stdin_text):
    return (
        isinstance(argv, (list, tuple)) and bool(argv)
        and all(isinstance(arg, str) and '\x00' not in arg for arg in argv)
        and bool(argv[0]) and type(timeout) in (int, float)
        and math.isfinite(timeout) and 0 < timeout <= 1800
        and type(output_limit) is int and 0 <= output_limit <= MAX_OUTPUT_LIMIT
        and (stdin_text is None or isinstance(stdin_text, str))
    )


def run(argv, env=None, stdin_text=None, *, timeout=1800, output_limit=65536):
    """Return (code, stdout, '') with bounded I/O; every failure drops stdout.

    124 means unavailable/timeout/invalid UTF-8/input; 125 means stdout overflow.
    Child nonzero exit codes are preserved without any child diagnostics.
    POSIX-only selectors keep both input and output pipes moving, without a
    reader thread, shell, temporary output file, or unbounded communicate().
    """
    if not _valid_args(argv, timeout, output_limit, stdin_text):
        return UNAVAILABLE
    try:
        incoming = (stdin_text or '').encode('utf-8')
    except UnicodeError:
        return UNAVAILABLE
    if len(incoming) > INPUT_LIMIT:
        return UNAVAILABLE
    child = None
    try:
        child = subprocess.Popen(
            list(argv), stdin=subprocess.PIPE if incoming else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, shell=False, start_new_session=True, bufsize=0,
        )
        deadline = time.monotonic() + timeout
        output = bytearray()
        position = 0
        with selectors.DefaultSelector() as selector:
            os.set_blocking(child.stdout.fileno(), False)
            selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
            if incoming:
                os.set_blocking(child.stdin.fileno(), False)
                selector.register(child.stdin, selectors.EVENT_WRITE, 'stdin')
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return UNAVAILABLE
                for key, _events in selector.select(remaining):
                    if key.data == 'stdout':
                        chunk = os.read(key.fd, min(8192, output_limit - len(output) + 1))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        elif len(output) + len(chunk) > output_limit:
                            return OVERFLOW
                        else:
                            output.extend(chunk)
                    else:
                        try:
                            position += os.write(key.fd, incoming[position:position + 8192])
                        except BrokenPipeError:
                            position = len(incoming)
                        if position == len(incoming):
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return UNAVAILABLE
        code = child.wait(timeout=remaining)
        if code != 0:
            return code, '', ''
        return 0, output.decode('utf-8', errors='strict'), ''
    except (OSError, ValueError, TypeError, UnicodeError, subprocess.SubprocessError):
        return UNAVAILABLE
    finally:
        if child is not None:
            # Also kill lingering descendants after a direct child exits with its
            # pipes closed: no background process belongs to a completed call.
            _kill_group(child)
            for stream in (child.stdin, child.stdout):
                if stream is not None:
                    stream.close()


def _environment(env):
    source = os.environ if env is None else env
    return {key: value for key, value in source.items()
            if isinstance(key, str) and isinstance(value, str) and not key.startswith('DOCKER_')}


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _refuse()
        result[key] = value
    return result


class LocalDockerRunner:
    """Callable pinned to one observed local Unix socket for one operation.

    Construct through local_docker_runner; neither context switches nor Docker
    endpoint environment variables may redirect subsequent child commands.
    This accepts Docker commands only; operation allowlisting belongs upstream.
    """

    def __init__(self, socket_url, *, env, runner):
        self.socket_url = socket_url
        self.env = dict(env)
        self.runner = runner

    def __call__(self, argv, env=None, stdin_text=None, *, timeout=1800, output_limit=65536):
        if (not isinstance(argv, (list, tuple)) or len(argv) < 2 or argv[0] != 'docker'
                or not all(isinstance(arg, str) for arg in argv)
                or argv[1].startswith('-')
                or any(arg.startswith(('--host', '--context', '--config', '--tls', '-H'))
                       for arg in argv[1:])):
            return UNAVAILABLE
        try:
            child_env = _environment(self.env if env is None else env)
            return self.runner(['docker', '--host', self.socket_url, *argv[1:]],
                               env=child_env, stdin_text=stdin_text,
                               timeout=timeout, output_limit=output_limit)
        except (OSError, ValueError, TypeError):
            return UNAVAILABLE


def local_docker_runner(*, env=None, runner=run):
    """Observe current context once, refuse remote, return local endpoint pin.

    Resolution inherits only PATH/HOME/LANG/LC_ALL, ignoring DOCKER_HOST,
    DOCKER_CONTEXT, DOCKER_CONFIG and TLS env redirections. It never falls back
    to a different context when the current context is malformed/remote.
    Docker Desktop socket symlinks are resolved to an existing actual socket.
    """
    try:
        clean = _environment(env)
        observe_env = {key: clean[key] for key in ('PATH', 'HOME', 'LANG', 'LC_ALL') if key in clean}
        result = runner(['docker', 'context', 'inspect'], env=observe_env,
                        stdin_text=None, timeout=10, output_limit=65536)
        if (not isinstance(result, (tuple, list)) or len(result) != 3
                or type(result[0]) is not int or result[0] != 0
                or not isinstance(result[1], str) or len(result[1].encode('utf-8')) > 65536):
            _refuse()
        contexts = json.loads(result[1], object_pairs_hook=_unique)
        if not isinstance(contexts, list) or len(contexts) != 1:
            _refuse()
        host = contexts[0]['Endpoints']['docker']['Host']
        if (not isinstance(host, str) or not host.startswith('unix:///')
                or any(char in host for char in ('\x00', '\n', '\r', '?', '#'))):
            _refuse('docker_context_not_local')
        socket_path = Path(host[len('unix://'):])
        if '..' in socket_path.parts or not socket_path.is_absolute():
            _refuse('docker_context_not_local')
        resolved = socket_path.resolve(strict=True)
        if not stat.S_ISSOCK(resolved.stat().st_mode):
            _refuse('docker_context_not_local')
        return LocalDockerRunner('unix://' + str(resolved), env=clean, runner=runner)
    except ProcessError:
        raise
    except (OSError, ValueError, TypeError, KeyError, AttributeError, UnicodeError):
        _refuse()
