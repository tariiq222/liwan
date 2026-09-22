# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Durable local operation receipts, fenced by an OS lock per inventory target.

The flock remains held for the entire external mutation. A different process
cannot take over while the first lives, even if a service-side lease expires.
There is deliberately no lease takeover path. A dead process leaves a durable
``mutating`` receipt; inspection converts it to ``needs_intervention``.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import stat
import uuid
from contextlib import contextmanager
from pathlib import Path


class JournalConflict(Exception):
    """A request identity was reused with a changed command or target."""


class TargetBusy(Exception):
    """Another process still owns the target lock."""


class JournalUnsafe(Exception):
    """State storage fails its ownership or permission requirements."""


def _invalid_outcome():
    msg = 'mutation did not return an authoritative outcome'
    raise RuntimeError(msg)


def payload_digest(fields, files, target_fingerprint):
    """Hash canonical command, actual input bytes and selected target identity."""
    digest = hashlib.sha256()
    digest.update(json.dumps(fields, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=False).encode('utf-8'))
    digest.update(b'\0target\0')
    digest.update(target_fingerprint.encode('ascii'))
    for path in files:
        raw = path if isinstance(path, bytes) else Path(path).read_bytes()
        digest.update(b'\0file\0')
        digest.update(len(raw).to_bytes(8, 'big'))
        digest.update(raw)
    return digest.hexdigest()


class OperationJournal:
    def __init__(self, root):
        self.root = Path(root)
        if not self.root.is_absolute():
            msg = 'state directory must be absolute'
            raise JournalUnsafe(msg)
        if self.root.is_symlink():
            msg = 'state directory cannot be a symlink'
            raise JournalUnsafe(msg)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = self.root.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            msg = 'state directory must be private and operator owned'
            raise JournalUnsafe(msg)
        self.database = self.root / 'operations.sqlite3'
        if self.database.is_symlink():
            msg = 'journal database cannot be a symlink'
            raise JournalUnsafe(msg)
        with self._connection() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS operations (
                target TEXT NOT NULL, request_id TEXT NOT NULL,
                operation_id TEXT NOT NULL UNIQUE, operation TEXT NOT NULL,
                digest TEXT NOT NULL, fingerprint TEXT NOT NULL,
                status TEXT NOT NULL, receipt TEXT,
                PRIMARY KEY (target, request_id)
            )''')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_operations_request '
                       'ON operations(request_id)')
            db.commit()

    @contextmanager
    def _connection(self):
        old = os.umask(0o077)
        try:
            db = sqlite3.connect(self.database, timeout=5)
        finally:
            os.umask(old)
        try:
            info = self.database.stat()
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                msg = 'journal database must be private and operator owned'
                raise JournalUnsafe(msg)
            db.execute('PRAGMA synchronous=FULL')
            yield db
        finally:
            db.close()

    def lock_path(self, target):
        name = hashlib.sha256(target.encode('utf-8')).hexdigest()
        path = self.root / f'{name}.lock'
        if path.is_symlink():
            msg = 'target lock cannot be a symlink'
            raise JournalUnsafe(msg)
        path.touch(mode=0o600, exist_ok=True)
        info = path.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            msg = 'target lock must be private and operator owned'
            raise JournalUnsafe(msg)
        return path

    @contextmanager
    def _target_lock(self, target):
        path = self.lock_path(target)
        with path.open('r+b') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                msg = 'target operation is already running'
                raise TargetBusy(msg) from error
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def _row(self, db, target, request_id):
        return db.execute(
            'SELECT operation_id, operation, digest, fingerprint, status, receipt '
            'FROM operations WHERE target = ? AND request_id = ?',
            (target, request_id),
        ).fetchone()

    def _uncertain(self, db, target, request_id, operation_id):
        receipt = {
            'operation_id': operation_id, 'request_id': request_id,
            'target': target, 'status': 'needs_intervention',
            'stage': 'mutation_uncertain', 'changed': True,
            'error': {'code': 'needs_intervention',
                      'message': 'The prior mutation outcome requires inspection'},
        }
        db.execute('UPDATE operations SET status = ?, receipt = ? '
                   'WHERE target = ? AND request_id = ?',
                   ('needs_intervention', json.dumps(receipt), target, request_id))
        db.commit()
        return receipt

    def inspect(self, target, request_id):
        with self._target_lock(target), self._connection() as db:
            row = self._row(db, target, request_id)
            if row is None:
                return None
            operation_id, operation, _digest, _fingerprint, status, receipt = row
            if status == 'mutating':
                value = self._uncertain(db, target, request_id, operation_id)
            else:
                value = json.loads(receipt)
            value.setdefault('operation', operation)
            return value

    def find_operation(self, target, operation_id):
        """Resolve an operation receipt only within the selected target."""
        with self._target_lock(target), self._connection() as db:
            row = db.execute(
                'SELECT request_id FROM operations WHERE target = ? AND operation_id = ?',
                (target, operation_id),
            ).fetchone()
            if row is None:
                return None
            operation, _digest, _fingerprint, status, receipt = self._row(db, target, row[0])[1:]
            if status == 'mutating':
                value = self._uncertain(db, target, row[0], operation_id)
            else:
                value = json.loads(receipt)
            value.setdefault('operation', operation)
            return value

    def execute(self, target, operation, request_id, digest, fingerprint, action):
        with self._target_lock(target):
            with self._connection() as db:
                bound = db.execute('SELECT target FROM operations WHERE request_id = ?',
                                   (request_id,)).fetchone()
                if bound is not None and bound[0] != target:
                    msg = 'request id is already bound to a different target'
                    raise JournalConflict(msg)
                row = self._row(db, target, request_id)
                if row is not None:
                    operation_id, old_operation, old_digest, old_fingerprint, status, receipt = row
                    if (old_operation, old_digest, old_fingerprint) != (operation, digest, fingerprint):
                        msg = 'request id already has a different payload or target'
                        raise JournalConflict(msg)
                    if status == 'mutating':
                        result = self._uncertain(db, target, request_id, operation_id)
                    else:
                        result = json.loads(receipt)
                    result.setdefault('operation', operation)
                    return result
                unresolved = db.execute(
                    "SELECT 1 FROM operations WHERE target = ? "
                    "AND status IN ('mutating', 'needs_intervention') LIMIT 1",
                    (target,),
                ).fetchone()
                if unresolved is not None:
                    msg = 'target has an unresolved prior mutation'
                    raise JournalUnsafe(msg)
                operation_id = 'op_' + uuid.uuid4().hex
                try:
                    db.execute('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                               (target, request_id, operation_id, operation, digest,
                                fingerprint, 'mutating', None))
                except sqlite3.IntegrityError as error:
                    msg = 'request id is already bound'
                    raise JournalConflict(msg) from error
                db.commit()
            try:
                result = dict(action(operation_id))
                result.update({'operation_id': operation_id, 'request_id': request_id,
                               'target': target, 'operation': operation})
                if result.get('status') not in ('ok', 'conflict', 'needs_intervention'):
                    _invalid_outcome()
            except BaseException:
                with self._connection() as db:
                    self._uncertain(db, target, request_id, operation_id)
                raise
            with self._connection() as db:
                db.execute('UPDATE operations SET status = ?, receipt = ? '
                           'WHERE target = ? AND request_id = ?',
                           (result['status'], json.dumps(result, sort_keys=True), target, request_id))
                db.commit()
            return result
