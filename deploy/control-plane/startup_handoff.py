#!/usr/bin/env python3
"""Transfer a reserved generation's lock into the full runtime supervisor."""
import os
import sys
from pathlib import Path

if len(sys.argv) < 3:
    raise SystemExit(2)
home = Path(sys.argv[1])
command = sys.argv[2:]
fd_text = os.environ.get('LIWAN_PROCESS_LOCK_FD')
if fd_text is None:
    raise SystemExit('missing_lifecycle_lock_capability')
try:
    fd = int(fd_text)
    actual, expected = os.fstat(fd), os.stat(home / 'processes.lock')
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino): raise ValueError
    import fcntl
    probe = os.open(home / 'processes.lock', os.O_RDWR)
    try: fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: pass
    else: raise ValueError
    finally: os.close(probe)
except (OSError, ValueError):
    raise SystemExit('invalid_lifecycle_lock_capability') from None
os.execvp(command[0], command)
