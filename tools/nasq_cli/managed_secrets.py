# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read bounded operator-owned secrets without following path symlinks.

The enclosing operator enrollment/directories remain trusted. This is not a
sandbox against the same UID or a promise to freeze a concurrently edited secret.
No filesystem modification, subprocess, or network access is performed.
"""
from __future__ import annotations

import os
import re
import stat
from contextlib import ExitStack

MAX_BYTES = 4096
_SECRET = re.compile(r'[A-Za-z0-9_-]{24,256}')


class SecretError(OSError):
    """A secret-free refusal, including for underlying filesystem exceptions."""

    code = 'secret_unavailable'

    def __init__(self):
        super().__init__(self.code)


def _check_file(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) not in (0o400, 0o600)
            or not 0 < info.st_size <= MAX_BYTES):
        raise SecretError()


def resolve_secret(handle: str) -> str:
    """Resolve one absolute canonical private regular-file handle, or refuse.

    Every directory component is opened with O_NOFOLLOW relative to the previous
    directory descriptor. The final file is stat-checked before opening (FIFO
    refusal), then opened nonblocking/no-follow and matched by device/inode.
    macOS callers must use canonical /private/... paths, not /tmp or /var aliases.
    """
    try:
        if (type(handle) is not str or not handle.startswith('/') or '\x00' in handle
                or len(handle) > 4096):
            raise SecretError()
        parts = handle.split('/')[1:]
        if not parts or any(part in ('', '.', '..') for part in parts):
            raise SecretError()
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        with ExitStack() as stack:
            directory = os.open('/', directory_flags)
            stack.callback(os.close, directory)
            for component in parts[:-1]:
                directory = os.open(component, directory_flags, dir_fd=directory)
                stack.callback(os.close, directory)
            before = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
            _check_file(before)
            descriptor = os.open(parts[-1], file_flags, dir_fd=directory)
            stack.callback(os.close, descriptor)
            opened = os.fstat(descriptor)
            _check_file(opened)
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                raise SecretError()
            raw = bytearray()
            while len(raw) <= MAX_BYTES:
                chunk = os.read(descriptor, MAX_BYTES + 1 - len(raw))
                if not chunk:
                    break
                raw.extend(chunk)
            after = os.fstat(descriptor)
            _check_file(after)
            if len(raw) > MAX_BYTES or len(raw) != after.st_size:
                raise SecretError()
        value = raw.decode('utf-8').strip()
        if (not _SECRET.fullmatch(value) or len(set(value)) < 8
                or any(token in value.lower() for token in ('change-me', 'changeme', 'placeholder'))):
            raise SecretError()
        return value
    except (OSError, ValueError, TypeError, OverflowError):
        raise SecretError() from None
