# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Strict file removal for the tenant drop effect: standard library only.

The tenant drop effect runs this module in two places. In-process it removes the host-side state (local backup
artifacts, side files, the AI egress hosts file). Inside the `odoo` and `restore-odoo` containers the effect
sends this file's own source to `python3 -c` with one JSON operation on stdin, so the code that removes a
filestore is the code the tests exercise. Nothing here imports another repository module.

Every name arrives already validated against an identifier or UUID pattern by the caller and is validated
again here. A parent directory must be an absolute path without symbolic links; the child is never a symbolic
link. The evidence returned holds counts and states only, never a file name below the removed root or content.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import sys

DATABASE_NAME = re.compile(r'[a-z][a-z0-9_]{0,62}')
UUID_NAME = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
FILE_NAME = re.compile(r'[a-z][a-z0-9_]{0,62}\.(?:json|hosts)')
EXPORT_DIRECTORY = 'tenant_exports'
MAX_STDIN = 65536


class FileRefused(Exception):
    """A refusal with a stable, non-secret code."""


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def require_directory(path):
    """An absolute, existing directory with no symbolic link on its way."""
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise FileRefused('path_invalid')
    for entry in [path, *path.parents]:
        if entry.is_symlink():
            raise FileRefused('path_symlink')
    if not path.is_dir():
        raise FileRefused('path_invalid')
    return path


def require_name(value, pattern):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise FileRefused('name_invalid')
    return value


def _entry_state(path):
    """'absent', 'directory' or 'file'; a symbolic link or anything else is refused."""
    if path.is_symlink():
        raise FileRefused('path_symlink')
    if not path.exists():
        return 'absent'
    if path.is_dir():
        return 'directory'
    if path.is_file():
        return 'file'
    raise FileRefused('path_invalid')


def tree_counts(path):
    """Counts under a directory without following links; refuses nothing, reads no content."""
    files = directories = size = exports = 0
    for current, names, entries in os.walk(path, followlinks=False):
        directories += len(names)
        for entry in entries:
            files += 1
            try:
                info = os.lstat(os.path.join(current, entry))
            except OSError:
                continue
            size += info.st_size
            if Path(current).relative_to(path).parts[:1] == (EXPORT_DIRECTORY,):
                exports += 1
    return {'files': files, 'directories': directories, 'bytes': size, 'exportFiles': exports}


def _remove_tree(path):
    try:
        shutil.rmtree(path)
    except OSError:
        raise FileRefused('remove_failed') from None
    if os.path.lexists(path):
        raise FileRefused('remove_failed')


def remove_tree(parent, name, pattern, request_id, dry_run):
    """Rename `<name>` to `<name>.deleting-<request id>`, then remove it; finish a leftover rename.

    States: `absent` (nothing there, done), `removed`, `resumed` (a crashed run had renamed it),
    `would_remove` (dry run). Both the target and its renamed twin present is ambiguous and refused.
    """
    parent = require_directory(parent)
    require_name(name, pattern)
    require_name(request_id, UUID_NAME)
    target = parent / name
    twin = parent / f'{name}.deleting-{request_id}'
    target_state, twin_state = _entry_state(target), _entry_state(twin)
    if 'file' in (target_state, twin_state):
        raise FileRefused('path_invalid')
    if target_state == 'directory' and twin_state == 'directory':
        raise FileRefused('filestore_ambiguous')
    if target_state == 'absent' and twin_state == 'absent':
        return {'state': 'absent', 'files': 0, 'directories': 0, 'bytes': 0, 'exportFiles': 0}
    source = target if target_state == 'directory' else twin
    counts = tree_counts(source)
    if dry_run:
        return {'state': 'would_remove', **counts}
    if source == target:
        os.rename(target, twin)
        _fsync_directory(parent)
    _remove_tree(twin)
    _fsync_directory(parent)
    return {'state': 'removed' if source == target else 'resumed', **counts}


def remove_file(parent, name, dry_run):
    """Remove one regular file by its exact name; absent is done, a link is refused."""
    parent = require_directory(parent)
    require_name(name, FILE_NAME)
    target = parent / name
    state = _entry_state(target)
    if state == 'absent':
        return {'state': 'absent'}
    if state != 'file':
        raise FileRefused('path_invalid')
    if dry_run:
        return {'state': 'would_remove'}
    target.unlink()
    _fsync_directory(parent)
    if os.path.lexists(target):
        raise FileRefused('remove_failed')
    return {'state': 'removed'}


def _operation_remove_filestore(payload):
    root = require_directory(payload['dataDir'])
    store = root / 'filestore'
    if not store.is_symlink() and not store.exists():
        return {'state': 'absent', 'files': 0, 'directories': 0, 'bytes': 0, 'exportFiles': 0}
    return remove_tree(store, payload['name'], DATABASE_NAME, payload['requestId'], payload['dryRun'])


def run(payload):
    """Dispatch one operation of the container protocol; returns evidence or `{'refused': code}`."""
    try:
        if not isinstance(payload, dict) or payload.get('op') != 'remove_filestore' or type(payload.get('dryRun')) is not bool:
            raise FileRefused('operation_unavailable')
        return _operation_remove_filestore(payload)
    except FileRefused as refusal:
        return {'refused': str(refusal)}
    except (KeyError, TypeError, OSError):
        return {'refused': 'path_invalid'}


def main(stdin=None, stdout=None):
    raw = (stdin or sys.stdin).read(MAX_STDIN)
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = None
    print(json.dumps(run(payload), separators=(',', ':')), file=stdout or sys.stdout)


if __name__ == '__main__':
    main()
