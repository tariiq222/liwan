"""Backup-only transaction on the existing tenant barrier and physical role fence."""
from pathlib import Path
from .state import ReleaseConflict


def backup_current(state, runtime, binding, request_id, output_dir, finalize):
    tenant=binding['tenantId']
    payload={'operation':'backup','binding':binding,'output':str(Path(output_dir))}
    with state.locked('global_maintenance'), state.locked(tenant):
        state.request(request_id,payload)
        receipt=state.receipt(request_id)
        if receipt['stage']=='verified':return receipt
        if receipt['stage']!='planned':raise ReleaseConflict('backup_requires_reconciliation')
        if state.binding(tenant)!=binding:raise ReleaseConflict('backup_binding_changed')
        route=state.route(tenant)
        if route.get('draining'):raise ReleaseConflict('previous_release_not_drained')
        runtime.prepare_backup(binding,route)
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
            runtime.resume_backup(binding,route)
            state.resume(tenant,route['fence'])
            if runtime.acknowledge(binding,route,False).get('ready') is not True:raise ReleaseConflict('release_guard_ack_missing')
            state.stage(request_id,tenant,'verified',route['fence'],backup_digest=result['digest'])
            return state.receipt(request_id)
        except BaseException:
            # If resume itself failed after clearing the barrier, fail closed again.
            state.maintenance(tenant,route['fence'])
            state.stage(request_id,tenant,'needs_intervention',route['fence'],error='backup_unverified')
            raise
