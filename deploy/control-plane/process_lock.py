#!/usr/bin/env python3
"""Hold one validated advisory-lock descriptor across runtime startup."""
import fcntl
import os
import sys
from pathlib import Path


def lock_path() -> Path:
    home = Path(os.environ.get('LIWAN_CONTROL_HOME', str(Path.home() / '.local/share/liwan-saas-control-local')))
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(home, 0o700)
    return home / 'processes.lock'


def validate_capability() -> int:
    path = lock_path()
    try:
        fd = int(os.environ['LIWAN_PROCESS_LOCK_FD'])
        actual, expected = os.fstat(fd), os.stat(path)
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError
        if not os.get_inheritable(fd):
            raise ValueError
        probe = os.open(path, os.O_RDWR)
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return fd
        else:
            raise ValueError
        finally:
            os.close(probe)
    except (OSError, ValueError, KeyError):
        raise SystemExit('invalid_or_unheld_lock_capability') from None
    return fd


if len(sys.argv) < 2:
    raise SystemExit(2)
mode = sys.argv[1]
if mode == '--check':
    validate_capability()
    raise SystemExit(0)
if mode == '--hold':
    command = sys.argv[2:]
    if not command:
        raise SystemExit(2)
    path = lock_path()
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.chmod(path, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    os.dup2(fd, 3, inheritable=True)
    if fd != 3:
        os.close(fd)
    os.set_inheritable(3, True)
    os.environ['LIWAN_PROCESS_LOCK_FD'] = '3'
    os.execvp(command[0], command)

command = sys.argv[1:]
if command[0].endswith('.sh') and not os.access(command[0], os.X_OK):
    command.insert(0, '/bin/bash')
elif command[0].endswith('.py') and not os.access(command[0], os.X_OK):
    command.insert(0, sys.executable)
if os.environ.get('LIWAN_PROCESS_LOCK_FD') is not None:
    validate_capability()
    os.execvp(command[0], command)
fd = os.open(lock_path(), os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX)
os.set_inheritable(fd, True)
os.environ['LIWAN_PROCESS_LOCK_FD'] = str(fd)
os.execvp(command[0], command)
