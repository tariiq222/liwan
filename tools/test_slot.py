# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run a heavy check inside one of the machine-wide test slots.

Every session and worktree on this machine shares the same few slots (``flock``
files under ``~/.cache/liwan-test-slots``), so Odoo test runs, type checks, the
full ``npm test`` and e2e runs queue instead of piling up. A slot is released
when its process exits, even after a crash. A command started inside a slot
(``LIWAN_TEST_SLOT`` is set) runs at once and takes no second slot.

    python3 -B tools/test_slot.py -- <command> [args...]
    python3 -B tools/test_slot.py --status
"""
from __future__ import annotations

import argparse
import fcntl
import os
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_SLOTS = 2
POLL_SECONDS = 2
REPORT_SECONDS = 60
HELD_ENV = 'LIWAN_TEST_SLOT'


def slot_dir():
    root = os.environ.get('LIWAN_TEST_SLOT_DIR')
    path = Path(root) if root else Path.home() / '.cache' / 'liwan-test-slots'
    path.mkdir(parents=True, exist_ok=True)
    return path


def slot_count():
    raw = os.environ.get('LIWAN_TEST_SLOTS', str(DEFAULT_SLOTS))
    if not raw.isdigit() or int(raw) < 1:
        raise SystemExit('test_slot: LIWAN_TEST_SLOTS must be a positive integer, got %r' % raw)
    return int(raw)


def try_slot(path, count, label):
    """``(index, handle)`` of a free slot, now marked with ``label``, or ``None``."""
    for index in range(count):
        handle = (path / ('slot-%d.lock' % index)).open('a+', encoding='utf-8')
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            continue
        handle.seek(0)
        handle.truncate()
        handle.write(label)
        handle.flush()
        return index, handle
    return None


def holders(path, count):
    """Labels of the slots currently held."""
    found = []
    for index in range(count):
        lock = path / ('slot-%d.lock' % index)
        if not lock.exists():
            continue
        with lock.open('a+', encoding='utf-8') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                handle.seek(0)
                found.append('slot %d: %s' % (index, handle.read().strip() or '?'))
    return found


def acquire(path, count, label, out=sys.stderr):
    """Block until a slot is free; returns ``(index, handle)``."""
    started = time.monotonic()
    reported = None
    while True:
        slot = try_slot(path, count, label)
        if slot:
            if reported is not None:
                out.write('test_slot: got slot %d after %ds\n' % (slot[0], time.monotonic() - started))
            return slot
        waited = time.monotonic() - started
        if reported is None or waited - reported >= REPORT_SECONDS:
            busy = '; '.join(holders(path, count)) or 'busy'
            out.write('test_slot: waiting for one of %d test slots (%s)\n' % (count, busy))
            out.flush()
            reported = waited
        time.sleep(POLL_SECONDS)


@contextmanager
def hold(label):
    """Hold a test slot for the ``with`` body; a no-op inside an already held slot.

    The slot number is exported in ``LIWAN_TEST_SLOT`` so the commands the body
    starts run inside it instead of queueing for another one.
    """
    if os.environ.get(HELD_ENV):
        yield
        return
    index, handle = acquire(slot_dir(), slot_count(), 'pid %d, %s, %s' % (os.getpid(), os.getcwd(), label[:160]))
    os.environ[HELD_ENV] = str(index)
    try:
        yield
    finally:
        del os.environ[HELD_ENV]
        handle.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--status', action='store_true', help='list the held slots and exit')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    path, count = slot_dir(), slot_count()
    if args.status:
        sys.stdout.write('\n'.join(holders(path, count) or ['all %d slots free' % count]) + '\n')
        return 0
    if not command:
        parser.error('a command is required')
    with hold(' '.join(command)):
        return subprocess.call(command)


if __name__ == '__main__':
    sys.exit(main())
