"""Per-tenant quiescent dump/filestore capture and explicit scratch restore."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import time
from .manifest import IMAGE
from .postgres import identifier


def _path(value, *, exists=False, directory=False):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path:
        raise ValueError('local_path_rejected')
    if exists and (not path.exists() or (directory and not path.is_dir())):
        raise ValueError('local_path_rejected')
    return path


def _tool(value):
    # Trusted executable references may be symlinks (notably venv Python);
    # preserve their invocation path so Python still detects the virtualenv.
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts: raise ValueError('release_tool_rejected')
    if not path.is_file() or not os.access(path, os.X_OK): raise ValueError('release_tool_rejected')
    return str(path)


def _run(argv, config, *, input=None, read_only=False):
    """No shell, bounded timeout, no raw command output in public errors."""
    try:
        timeout = config.get('timeoutSeconds', 120)
        if not isinstance(timeout, (int, float)) or not 0 < timeout <= 3600: raise ValueError()
        env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        pg_env = config.get('pgEnv', {})
        if set(pg_env) - {'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSFILE', 'PGSSLMODE'}:
            raise ValueError()
        if any(not isinstance(value, str) or '\x00' in value or '\n' in value for value in pg_env.values()): raise ValueError()
        if 'PGPASSFILE' in pg_env: _path(pg_env['PGPASSFILE'], exists=True)
        env.update(pg_env)
        if read_only: env['PGOPTIONS'] = '-c default_transaction_read_only=on'
        result = config.get('runner', subprocess.run)(argv, input=input, text=True,
            capture_output=True, shell=False, check=False, timeout=timeout, env=env)
        if result.returncode != 0: raise ValueError()
        return result.stdout
    except Exception:
        raise ValueError('release_process_failed') from None


def _sha(path, deadline=None):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if deadline is not None: deadline.remaining()
            digest.update(block)
    return digest.hexdigest()


class Deadline:
    """One absolute monotonic budget for a whole backup step; never renewed.

    ``remaining`` raises once the budget is spent, so every caller that asks
    before a query, child process, block or fsync stops at the same instant.
    """
    def __init__(self, seconds, clock=None):
        if type(seconds) not in (int, float) or not 0 < seconds <= 3600: raise ValueError('backup_deadline_rejected')
        self.clock = clock or time.monotonic
        self.end = self.clock() + seconds

    def remaining(self, cap=None):
        left = self.end - self.clock()
        if left <= 0: raise ValueError('backup_deadline_exceeded')
        return left if cap is None else min(left, cap)


class _Bounded:
    """Archive reader that asks the shared deadline before every block."""
    def __init__(self, source, deadline): self.source, self.deadline = source, deadline
    def read(self, size=-1):
        self.deadline.remaining()
        return self.source.read(size)


def _quiescent(binding, proof):
    if (not isinstance(proof, dict) or any(proof.get(key) != binding.get(key) for key in ('tenantId', 'database', 'fence'))
            or type(binding.get('fence')) is not int or binding['fence'] < 1 or proof.get('transactionScope','tenant') != 'tenant' or proof.get('gateClosed') is not True
            or any(type(proof.get(key)) is not int or proof[key] != 0 for key in ('admittedWriters', 'activeTransactions', 'oldConnections'))):
        raise ValueError('tenant_not_quiescent')


def _store_entries(store, deadline=None):
    entries = []
    for directory, folders, files in os.walk(store, followlinks=False):
        for name in sorted([*folders, *files]):
            if deadline is not None: deadline.remaining()
            path = Path(directory) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise ValueError('filestore_entry_rejected')
            entries.append(path)
    return sorted(entries)


def capture_tenant(binding, quiescence, config):
    """Capture after the caller's durable gate/drain evidence; no global stop.

    Optional ``recheck(binding)`` must return fresh same-fence quiescence before
    and after copying. Consistency remains conditional on that durable gate.
    """
    if config.get('mode') != 'local': raise ValueError('unsupported_runtime_mode')
    identifier(binding.get('database'))
    _quiescent(binding, quiescence)
    if config.get('recheck'): _quiescent(binding, config['recheck'](binding))
    image = config.get('image')
    if not isinstance(image, str) or not IMAGE.fullmatch(image): raise ValueError('backup_image_rejected')
    store = _path(config['filestorePath'], exists=True, directory=True)
    output = _path(config['outputDir'])
    if store.name != binding['database'] or output.exists() or store == output or store in output.parents:
        raise ValueError('backup_path_rejected')
    entries = _store_entries(store)
    tool = _tool(config['pgDump'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    dump, archive = output / 'database.dump', output / 'filestore.tar'
    _run([tool, '--format=custom', '--serializable-deferrable', '--no-owner', '--file', str(dump),
          '--dbname', binding['database']], config)
    if not dump.is_file() or dump.is_symlink() or not dump.stat().st_size:
        raise ValueError('backup_dump_missing')
    with tarfile.open(archive, 'w', dereference=True) as target:
        for path in entries:
            if path.is_symlink(): raise ValueError('filestore_entry_rejected')
            target.add(path, arcname=path.relative_to(store).as_posix(), recursive=False)
    if config.get('recheck'): _quiescent(binding, config['recheck'](binding))
    receipt = {'version': 1, 'tenantId': binding['tenantId'], 'database': binding['database'],
               'filestore': binding.get('filestore'), 'fence': binding['fence'], 'image': image,
               'hashes': {'database.dump': _sha(dump), 'filestore.tar': _sha(archive)},
               'consistency': 'quiescent_gate', 'restoreVerified': False}
    receipt_path = output / 'receipt.json'
    with receipt_path.open('x', encoding='utf-8') as target:
        json.dump(receipt, target, sort_keys=True); target.flush(); os.fsync(target.fileno())
    for path in (dump, archive):
        with path.open('rb') as source: os.fsync(source.fileno())
    directory_fd = os.open(output, os.O_RDONLY)
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)
    return receipt


def _window_proof(binding, proof):
    _quiescent(binding, proof)
    denied = proof.get('deniedWriters')
    if (not isinstance(denied, list) or not denied or len(set(denied)) != len(denied)
            or any(not isinstance(role, str) for role in denied) or proof.get('writerConnections') != 0):
        raise ValueError('writer_window_unproven')


def _fsync(path, deadline):
    deadline.remaining()
    descriptor = os.open(path, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    deadline.remaining()


def capture_window(binding, quiescence, config, deadline):
    """Backup-current capture inside a closed writer window; never used by releases.

    ``deadline`` is the caller's absolute budget, fixed before the filestore walk.
    It bounds the walk, the dump child, every archived block, both hashes, every
    fsync and each ``recheck(binding, deadline)``, which must prove the denied
    writer set before the dump and after the archive. The receipt is published
    by rename only while the budget remains; otherwise none is left behind and
    the partial artifacts stay for the operator.
    """
    if config.get('mode') != 'local': raise ValueError('unsupported_runtime_mode')
    if not isinstance(deadline, Deadline): raise ValueError('backup_deadline_rejected')
    identifier(binding.get('database'))
    _window_proof(binding, quiescence)
    recheck = config.get('recheck')
    if not callable(recheck): raise ValueError('backup_recheck_required')
    image = config.get('image')
    if not isinstance(image, str) or not IMAGE.fullmatch(image): raise ValueError('backup_image_rejected')
    per_child = config.get('timeoutSeconds', 120)
    if type(per_child) not in (int, float) or not 0 < per_child <= 3600: raise ValueError('backup_timeout_rejected')
    store = _path(config['filestorePath'], exists=True, directory=True)
    output = _path(config['outputDir'])
    if store.name != binding['database'] or output.exists() or store == output or store in output.parents:
        raise ValueError('backup_path_rejected')
    entries = _store_entries(store, deadline)
    deadline.remaining()
    tool = _tool(config['pgDump'])
    _window_proof(binding, recheck(binding, deadline))
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    dump, archive = output / 'database.dump', output / 'filestore.tar'
    _run([tool, '--format=custom', '--serializable-deferrable', '--no-owner', '--file', str(dump),
          '--dbname', binding['database']], {**config, 'timeoutSeconds': deadline.remaining(per_child)})
    deadline.remaining()
    if not dump.is_file() or dump.is_symlink() or not dump.stat().st_size:
        raise ValueError('backup_dump_missing')
    # dereference: every name is archived as its own regular file, never as a
    # hard-link record that validate_backup (and restore) would refuse.
    with tarfile.open(archive, 'w', dereference=True) as target:
        for path in entries:
            deadline.remaining()
            if path.is_symlink(): raise ValueError('filestore_entry_rejected')
            info = target.gettarinfo(str(path), arcname=path.relative_to(store).as_posix())
            if info.isfile():
                with path.open('rb') as source: target.addfile(info, _Bounded(source, deadline))
            elif info.isdir(): target.addfile(info)
            else: raise ValueError('filestore_entry_rejected')
    for path in (dump, archive): _fsync(path, deadline)
    hashes = {'database.dump': _sha(dump, deadline), 'filestore.tar': _sha(archive, deadline)}
    _window_proof(binding, recheck(binding, deadline))
    receipt = {'version': 1, 'tenantId': binding['tenantId'], 'database': binding['database'],
               'filestore': binding.get('filestore'), 'fence': binding['fence'], 'image': image,
               'hashes': hashes, 'consistency': 'quiescent_gate', 'restoreVerified': False}
    pending, receipt_path = output / 'receipt.pending', output / 'receipt.json'
    with pending.open('x', encoding='utf-8') as target:
        json.dump(receipt, target, sort_keys=True); target.flush(); os.fsync(target.fileno())
    deadline.remaining()
    os.rename(pending, receipt_path)
    try:
        _fsync(output, deadline)
    except BaseException:
        # A receipt published past the budget is not a success; keep the evidence unpublished.
        os.rename(receipt_path, pending)
        raise
    return receipt


def validate_backup(backup):
    """Check both complete artifacts before any restore-side mutation."""
    try:
        root = _path(backup, exists=True, directory=True)
        receipt_path = _path(root / 'receipt.json', exists=True)
        if receipt_path.stat().st_size > 65536: raise ValueError()
        receipt = json.loads(receipt_path.read_text())
        if (receipt.get('version') != 1 or receipt.get('consistency') != 'quiescent_gate'
                or type(receipt.get('fence')) is not int or receipt['fence'] < 1
                or not IMAGE.fullmatch(receipt.get('image', ''))): raise ValueError()
        identifier(receipt['database'])
        if set(receipt['hashes']) != {'database.dump', 'filestore.tar'}: raise ValueError()
        for name, digest in receipt['hashes'].items():
            path = _path(root / name, exists=True)
            if not path.is_file() or not re.fullmatch('[a-f0-9]{64}', digest) or _sha(path) != digest: raise ValueError()
        with tarfile.open(root / 'filestore.tar', 'r') as archive:
            for member in archive.getmembers():
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()): raise ValueError()
        return {'valid': True, 'receipt': receipt}
    except Exception:
        return {'valid': False, 'reason': 'backup_validation_failed'}


def restore_tenant(backup, target_binding, config):
    """Restore once into an absent scratch DB/path; never downgrade a live DB.

    This establishes artifact restoration only. ``restoreVerified`` stays false
    until independent ORM/business acceptance on the restored target.
    """
    if (config.get('mode') != 'local' or config.get('restoreAllowed') is not True
            or config.get('writesResumed') is not False): raise ValueError('restore_not_authorized')
    db = target_binding.get('database'); identifier(db)
    if 'scratch' not in db or re.search(r'(?:^|_)(?:odoo19|prod|production|postgres|template[01])(?:_|$)', db):
        raise ValueError('restore_target_rejected')
    evidence = validate_backup(backup)
    if not evidence['valid']: raise ValueError('backup_validation_failed')
    receipt=evidence['receipt']
    source={key:receipt[key] for key in ('tenantId','database','filestore','fence')}
    if target_binding.get('tenantId') != receipt['tenantId'] or target_binding.get('filestore') != db or config.get('recoverySource') != source:
        raise ValueError('restore_binding_mismatch')
    destination = _path(config['targetFilestore'])
    if destination.exists() or destination.name != db: raise ValueError('restore_target_rejected')
    createdb, pg_restore = _tool(config['createdb']), _tool(config['pgRestore'])
    _run([createdb, '--maintenance-db=postgres', db], config)
    _run([pg_restore, '--no-owner', '--exit-on-error', '--dbname', db, str(Path(backup) / 'database.dump')], config)
    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
    with tarfile.open(Path(backup) / 'filestore.tar', 'r') as archive:
        for member in archive.getmembers():
            path = destination / member.name
            if member.isdir(): path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, path.open('xb') as target:
                    for block in iter(lambda: source.read(1024 * 1024), b''): target.write(block)
    return {'restored': True, 'database': db, 'image': evidence['receipt']['image'],
            'fence': evidence['receipt']['fence'], 'restoreVerified': False}
