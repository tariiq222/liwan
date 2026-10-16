#!/usr/bin/env python3
"""Recover dead records and reserve next generation under caller-held flock."""
import os
import secrets
import sys
from pathlib import Path
from recover_generation import recover, recover_reservation

if len(sys.argv) != 2:
    raise SystemExit(2)
home = Path(sys.argv[1])
state = home / 'processes'
if state.is_symlink() or not state.is_dir():
    raise SystemExit('invalid_process_directory')
fd_text = os.environ.get('WEBVUE_PROCESS_LOCK_FD')
if fd_text is None:
    raise SystemExit('missing_lifecycle_lock_capability')
try:
    fd = int(fd_text)
    a, b = os.fstat(fd), os.stat(home / 'processes.lock')
    if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino) or not os.get_inheritable(fd): raise ValueError
    import fcntl
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    probe = os.open(home / 'processes.lock', os.O_RDWR)
    try:
        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        pass
    else:
        raise ValueError
    finally:
        os.close(probe)
except (OSError, ValueError):
    raise SystemExit('invalid_or_unheld_lock_capability') from None
entries = list(state.iterdir())
if entries and (state / 'generation').exists():
    if len(entries) == 1 and entries[0].name == 'generation' and not entries[0].is_symlink() and entries[0].is_file():
        root_text, node_text = os.environ.get('WEBVUE_REPOSITORY_ROOT'), os.environ.get('WEBVUE_NODE_BIN')
        if not root_text or not node_text:
            raise SystemExit('reservation_runtime_identity_unavailable')
        recover_reservation(state, home, Path(root_text).resolve(), Path(node_text).resolve(), os.getpid())
    else:
        recover(state, home)
    if list(state.iterdir()):
        raise SystemExit('process_records_not_recovered')
elif entries:
    raise SystemExit('partial_generation_without_marker')
generation = secrets.token_hex(16)
fd = os.open(state / 'generation', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(generation + '\n')
