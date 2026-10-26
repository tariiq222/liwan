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


def read_intent(state, tenant, request_id):
    path = intent_path(state, tenant, request_id)
    if not path.is_file() or path.is_symlink(): raise ReleaseConflict('backup_intent_missing')
    return json.loads(path.read_text())


def _reconcile(state, runtime, binding, request_id):
    """Restore the previous state of an interrupted backup; never capture again."""
    tenant = binding['tenantId']
    if state.binding(tenant) != binding: raise ReleaseConflict('backup_binding_changed')
    route = state.route(tenant)
    previous = read_intent(state, tenant, request_id)
    try:
        runtime.reconcile_backup(binding, route, previous)
        state.resume(tenant, route['fence'])
        if runtime.acknowledge(binding, route, False).get('ready') is not True:
            raise ReleaseConflict('release_guard_ack_missing')
    except BaseException:
        state.maintenance(tenant, route['fence'])
        state.stage(request_id, tenant, 'needs_intervention', route['fence'], error='backup_reconciliation_failed')
        raise
    state.stage(request_id, tenant, 'reconciled', route['fence'])
    return state.receipt(request_id)


def backup_current(state, runtime, binding, request_id, output_dir, finalize):
    tenant=binding['tenantId']
    payload={'operation':'backup','binding':binding,'output':str(Path(output_dir))}
    with state.locked('global_maintenance'), state.locked(tenant):
        state.request(request_id,payload)
        receipt=state.receipt(request_id)
        if receipt['stage'] in ('verified','reconciled'):return receipt
        if receipt['stage']=='needs_intervention':return _reconcile(state,runtime,binding,request_id)
        if receipt['stage']!='planned':raise ReleaseConflict('backup_requires_reconciliation')
        if state.binding(tenant)!=binding:raise ReleaseConflict('backup_binding_changed')
        route=state.route(tenant)
        if route.get('draining'):raise ReleaseConflict('previous_release_not_drained')
        previous=runtime.prepare_backup(binding,route)
        write_intent(state,tenant,request_id,previous)
        state.stage(request_id,tenant,'prepared',route['fence'])
        try:
            state.maintenance(tenant,route['fence'])
            if runtime.acknowledge(binding,route,True).get('ready') is not True:raise ReleaseConflict('release_guard_ack_missing')
            proof=runtime.quiesce(binding,route)
            if (proof.get('fence')!=route['fence'] or proof.get('gateClosed') is not True
                    or any(type(proof.get(k)) is not int or proof[k]!=0 for k in ('admittedWriters','activeTransactions','oldConnections'))):
                raise ReleaseConflict('backup_quiescence_unverified')
            result=runtime.capture_into(binding,proof,output_dir)
            if result.get('fence')!=route['fence'] or not result.get('digest'):raise ReleaseConflict('backup_unverified')
            finalize(result)
            state.stage(request_id,tenant,'backed_up',route['fence'],backup_digest=result['digest'])
            runtime.resume_backup(binding,route,previous)
            state.resume(tenant,route['fence'])
            if runtime.acknowledge(binding,route,False).get('ready') is not True:raise ReleaseConflict('release_guard_ack_missing')
            state.stage(request_id,tenant,'verified',route['fence'],backup_digest=result['digest'])
            return state.receipt(request_id)
        except BaseException:
            # A failed resume may already have re-opened writers, so deny them and
            # stop the owned cron before the HTTP barrier is the only thing left.
            try:
                runtime.fail_closed_backup(binding,route)
                error='backup_unverified'
            except BaseException:
                error='backup_fail_closed_unverified'
            state.maintenance(tenant,route['fence'])
            state.stage(request_id,tenant,'needs_intervention',route['fence'],error=error)
            raise
