/** UI availability only. The control API and worker enforce current grants again. */
export function canPublishRestore(operation: {type:string;status:string;restore_publication?:{status:string}} | null | undefined, can:(capability:'vendor.operations.run'|'vendor.tenants.manage')=>boolean):boolean {
  return operation?.type==='restore' && operation.status==='verified'
    && operation.restore_publication?.status==='not_requested'
    && can('vendor.operations.run') && can('vendor.tenants.manage')
}
