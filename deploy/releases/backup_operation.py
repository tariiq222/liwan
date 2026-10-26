"""Backup-only transaction on the existing tenant barrier and writer fence."""
import json
from pathlib import Path
from .state import ReleaseConflict, atomic_json, name


def intent_path(state, tenant, request_id):
    """Private durable record of the state this request must restore."""
    return state.root / 'backup_intents' / name(tenant) / (name(request_id) + '.json')


def write_intent(state, tenant, request_id, previous):
    """Persist the previous state before the first effect; never silently replace it."""
    path = intent_path(state, tenant, request_id)
    if path.is_symlink(): raise ReleaseConflict('backup_intent_invalid')
    if path.exists():
        if json.loads(path.read_text()) != previous: raise ReleaseConflict('backup_intent_conflict')
        return previous
    atomic_json(path, previous)
    return previous


TERMINAL = ('verified', 'reconciled')


def _request_stage(state, request_id):
    """Stage of a recorded request, or None when this id was never recorded."""
    try:
        return state.receipt(request_id)['stage']
    except ReleaseConflict as error:
        if str(error) == 'release_request_missing': return None
        raise


def _refuse_pending(state, tenant, request_id):
    """Refuse a new capture while the tenant is closed or another backup is unresolved.

    A maintenance marker means a fence (backup or release) still owns the tenant,
    and an intent whose request is not terminal is a backup that only its own
    request id may recover. Capturing on top would record the fenced state as
    "previous" and reopen nothing that request owes. Runs before any write.
    """
    marker = state.routes / (name(tenant) + '.maintenance')
    if marker.exists() or marker.is_symlink(): raise ReleaseConflict('backup_operation_pending')
    directory = state.root / 'backup_intents' / name(tenant)
    if directory.is_symlink(): raise ReleaseConflict('backup_operation_pending')
    if not directory.exists(): return
    for path in directory.iterdir():
        if path.name.startswith('.'): continue  # atomic_json temporary
        if path.is_symlink() or not path.is_file() or path.suffix != '.json':
            raise ReleaseConflict('backup_operation_pending')
        if path.stem != request_id and _request_stage(state, path.stem) not in TERMINAL:
            raise ReleaseConflict('backup_operation_pending')


def read_intent(state, tenant, request_id):
    path = intent_path(state, tenant, request_id)
    if not path.is_file() or path.is_symlink(): raise ReleaseConflict('backup_intent_missing')
    return json.loads(path.read_text())


def _fail_closed(state, runtime, binding, route, request_id, previous, error):
    """Close the tenant again in barrier order, then record the intervention.

    A failed resume or reconciliation may already have removed the maintenance
    marker, re-admitted writers or restarted cron. The durable marker comes back
    first, then the same window entry as a capture (guard ACK, lease drain, writer
    fence, owned cron stop). If any step fails the marker stays and the error says
    the fence is unverified; nothing here ever reopens admission.
    """
    try:
        state.maintenance(binding['tenantId'], route['fence'])
        runtime.fence_backup(binding, route, previous)
    except BaseException:
        error = 'backup_fail_closed_unverified'
    state.stage(request_id, binding['tenantId'], 'needs_intervention', route['fence'], error=error)


def _reconcile(state, runtime, binding, request_id):
    """Restore the previous state of an interrupted backup; never capture again.

    Valid from any non-terminal stage: a process killed in ``prepared`` or
    ``backed_up`` leaves the same durable intent as a handled failure.
    """
    tenant = binding['tenantId']
    if state.binding(tenant) != binding: raise ReleaseConflict('backup_binding_changed')
    route = state.route(tenant)
    previous = read_intent(state, tenant, request_id)
    try:
        state.maintenance(tenant, route['fence'])
        runtime.reconcile_backup(binding, route, previous)
        state.resume(tenant, route['fence'])
        if runtime.acknowledge(binding, route, False).get('ready') is not True:
            raise ReleaseConflict('release_guard_ack_missing')
    except BaseException:
        _fail_closed(state, runtime, binding, route, request_id, previous, 'backup_reconciliation_failed')
        raise
    state.stage(request_id, tenant, 'reconciled', route['fence'])
    return state.receipt(request_id)


def backup_current(state, runtime, binding, request_id, output_dir, finalize=None):
    """Capture one tenant inside the writer window and restore its previous state.

    One absolute budget (``runtime.backup_deadline()``) starts with the first
    effect and covers the writer fence, capture, the bounded final validation,
    ``finalize`` and the resume. ``finalize`` is an optional caller step on the
    validated capture; it is not preempted, but the budget is checked after it,
    and an overrun anywhere fails closed and never reports ``verified``.
    """
    tenant = binding['tenantId']
    payload = {'operation': 'backup', 'binding': binding, 'output': str(Path(output_dir))}
    with state.locked('global_maintenance'), state.locked(tenant):
        if _request_stage(state, request_id) in (None, 'planned'): _refuse_pending(state, tenant, request_id)
        state.request(request_id, payload)
        receipt = state.receipt(request_id)
        if receipt['stage'] in TERMINAL: return receipt
        if receipt['stage'] != 'planned': return _reconcile(state, runtime, binding, request_id)
        if state.binding(tenant) != binding: raise ReleaseConflict('backup_binding_changed')
        route = state.route(tenant)
        if route.get('draining'): raise ReleaseConflict('previous_release_not_drained')
        previous = runtime.prepare_backup(binding, route)
        deadline = runtime.backup_deadline()
        write_intent(state, tenant, request_id, previous)
        state.stage(request_id, tenant, 'prepared', route['fence'])
        try:
            state.maintenance(tenant, route['fence'])
            if runtime.acknowledge(binding, route, True).get('ready') is not True: raise ReleaseConflict('release_guard_ack_missing')
            proof = runtime.fence_backup(binding, route, previous)
            if (proof.get('fence') != route['fence'] or proof.get('gateClosed') is not True
                    or any(type(proof.get(k)) is not int or proof[k] != 0 for k in ('admittedWriters', 'activeTransactions', 'oldConnections'))):
                raise ReleaseConflict('backup_quiescence_unverified')
            deadline.remaining()
            result = runtime.capture_backup(binding, proof, output_dir, deadline)
            if result.get('fence') != route['fence'] or not result.get('digest'): raise ReleaseConflict('backup_unverified')
            runtime.validate_capture(result, deadline)
            if finalize is not None: finalize(result)
            deadline.remaining()
            state.stage(request_id, tenant, 'backed_up', route['fence'], backup_digest=result['digest'])
            runtime.resume_backup(binding, route, previous, deadline)
            state.resume(tenant, route['fence'])
            if runtime.acknowledge(binding, route, False).get('ready') is not True: raise ReleaseConflict('release_guard_ack_missing')
            deadline.remaining()
            state.stage(request_id, tenant, 'verified', route['fence'], backup_digest=result['digest'])
            return state.receipt(request_id)
        except BaseException:
            _fail_closed(state, runtime, binding, route, request_id, previous, 'backup_unverified')
            raise
