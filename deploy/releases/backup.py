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


def _run(argv, config, *, input=None, read_only=False, timeout=None):
    """No shell, bounded timeout, no raw command output in public errors."""
    try:
        timeout = config.get('timeoutSeconds', 120) if timeout is None else timeout
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


def _budget(config):
    """One monotonic budget for the whole window; each child may take less, never more."""
    total = config.get('totalDeadlineSeconds', 600)
    if not isinstance(total, (int, float)) or not 0 < total <= 3600: raise ValueError('backup_deadline_rejected')
    return time.monotonic() + total


def _remaining(deadline, per_child):
    left = deadline - time.monotonic()
    if left <= 0: raise ValueError('backup_deadline_exceeded')
    return min(left, per_child)


def _sha(path, deadline=None):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if deadline is not None: _remaining(deadline, 1)
            digest.update(block)
    return digest.hexdigest()


class _Bounded:
    """File wrapper that enforces the shared deadline on every archived read."""
    def __init__(self, source, deadline): self.source, self.deadline = source, deadline
    def read(self, size=-1):
        _remaining(self.deadline, 1)
        return self.source.read(size)


def _quiescent(binding, proof, *, writer_window=False):
    if (not isinstance(proof, dict) or any(proof.get(key) != binding.get(key) for key in ('tenantId', 'database', 'fence'))
            or type(binding.get('fence')) is not int or binding['fence'] < 1 or proof.get('transactionScope','tenant') != 'tenant' or proof.get('gateClosed') is not True
            or any(type(proof.get(key)) is not int or proof[key] != 0 for key in ('admittedWriters', 'activeTransactions', 'oldConnections'))):
        raise ValueError('tenant_not_quiescent')
    if writer_window:
        denied = proof.get('deniedWriters')
        if (not isinstance(denied, list) or not denied or len(set(denied)) != len(denied)
                or any(not isinstance(role, str) for role in denied) or proof.get('writerConnections') != 0):
            raise ValueError('writer_window_unproven')


def _store_entries(store):
    entries = []
    for directory, folders, files in os.walk(store, followlinks=False):
        for name in sorted([*folders, *files]):
            path = Path(directory) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise ValueError('filestore_entry_rejected')
            entries.append(path)
    return sorted(entries)


def capture_tenant(binding, quiescence, config):
    """Capture after the caller's durable gate/drain evidence; no global stop.

    In ``writerWindow`` mode the proof must carry the denied writer set and a
    callable ``recheck(binding, timeout)`` must return fresh same-fence evidence
    before and after copying, so consistency rests on the closed window rather than
    on one dict a caller supplies. One monotonic budget bounds the dump, every
    archived entry and block, every hashed block and each recheck (given its
    remaining time as ``timeout``).
    """
    if config.get('mode') != 'local': raise ValueError('unsupported_runtime_mode')
    identifier(binding.get('database'))
    window = config.get('writerWindow') is True
    _quiescent(binding, quiescence, writer_window=window)
    recheck = config.get('recheck')
    if window and not callable(recheck): raise ValueError('backup_recheck_required')
    image = config.get('image')
    if not isinstance(image, str) or not IMAGE.fullmatch(image): raise ValueError('backup_image_rejected')
    store = _path(config['filestorePath'], exists=True, directory=True)
    output = _path(config['outputDir'])
    if store.name != binding['database'] or output.exists() or store == output or store in output.parents:
        raise ValueError('backup_path_rejected')
    entries = _store_entries(store)
    tool = _tool(config['pgDump'])
    per_child = config.get('timeoutSeconds', 120)
    if not isinstance(per_child, (int, float)) or not 0 < per_child <= 3600: raise ValueError('backup_timeout_rejected')
    deadline = _budget(config)
    if recheck: _quiescent(binding, recheck(binding, _remaining(deadline, per_child)), writer_window=window)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    dump, archive = output / 'database.dump', output / 'filestore.tar'
    _run([tool, '--format=custom', '--serializable-deferrable', '--no-owner', '--file', str(dump),
          '--dbname', binding['database']], config, timeout=_remaining(deadline, per_child))
    if not dump.is_file() or dump.is_symlink() or not dump.stat().st_size:
        raise ValueError('backup_dump_missing')
    with tarfile.open(archive, 'w') as target:
        for path in entries:
            _remaining(deadline, per_child)
            if path.is_symlink(): raise ValueError('filestore_entry_rejected')
            info = target.gettarinfo(str(path), arcname=path.relative_to(store).as_posix())
            if info.isfile():
                with path.open('rb') as source: target.addfile(info, _Bounded(source, deadline))
            else: target.addfile(info)
    if recheck: _quiescent(binding, recheck(binding, _remaining(deadline, per_child)), writer_window=window)
    hashes = {'database.dump': _sha(dump, deadline), 'filestore.tar': _sha(archive, deadline)}
    receipt = {'version': 1, 'tenantId': binding['tenantId'], 'database': binding['database'],
               'filestore': binding.get('filestore'), 'fence': binding['fence'], 'image': image,
               'hashes': hashes,
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
