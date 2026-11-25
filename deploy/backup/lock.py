# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One backup per database at a time: an exclusive, non-blocking ``flock`` per database.

The lock lives as long as the file descriptor, so it is released on every exit path: a
normal return, an exception, or the process dying. A second run for the same database is
refused at once; runs for other databases do not wait on it.
"""
from __future__ import annotations

import fcntl
import os
import stat
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from deploy.backup.errors import BackupError, require

if TYPE_CHECKING:
    from collections.abc import Iterator

LOCK_DIR_NAME = 'liwan-backup-locks'
LOCK_FILE_MODE = 0o644


def lock_directory() -> Path:
    """The private directory under the system temporary directory that holds the lock files.

    It is refused unless this user owns it, so another user cannot plant a lock directory
    (or a symlink to one) there.
    """
    directory = Path(tempfile.gettempdir()) / LOCK_DIR_NAME
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    require(
        stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid(),
        f'default lock directory {directory} is not a directory owned by this user',
    )
    return directory


def open_lock_file(path: Path) -> int:
    """Open (creating it if needed) the lock file read-only and return its descriptor.

    ``flock`` needs no write access, and the file holds no data, so it is created ``0644``
    (set explicitly, the umask must not narrow it) and a second user can lock the file the
    first one left behind. A symlink is refused, and so is anything but a regular file; the
    open never blocks, so a FIFO planted in a shared directory cannot hang the run.
    """
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        try:
            descriptor, created = os.open(path, flags | os.O_CREAT | os.O_EXCL, LOCK_FILE_MODE), True
        except FileExistsError:
            descriptor, created = os.open(path, flags), False
    except OSError as error:
        raise BackupError(f'cannot open the backup lock {path}: {error.strerror}') from error
    try:
        if created:
            os.fchmod(descriptor, LOCK_FILE_MODE)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise BackupError(f'the backup lock {path} is not a regular file')
    except OSError as error:
        os.close(descriptor)
        raise BackupError(f'cannot prepare the backup lock {path}: {error.strerror}') from error
    except BackupError:
        os.close(descriptor)
        raise
    return descriptor


@contextmanager
def database_lock(db: str) -> Iterator[None]:
    """Hold an exclusive, non-blocking lock on this database's lock file."""
    path = lock_directory() / f'{db}.lock'
    descriptor = open_lock_file(path)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError(
                f'another backup of database {db} is already running (lock {path}); '
                'refusing a concurrent run',
            ) from None
        except OSError as error:
            raise BackupError(f'cannot lock {path}: {error.strerror}') from error
        yield
    finally:
        os.close(descriptor)
