/** Loop policy only; caller provides an explicitly configured trusted dispatcher.
 * Never requeue an effect here. Each tick delegates claims and crash reconciliation
 * to durable storage. Non-transient failures stop for operator inspection. */
export type SharedLoopDependencies = {
  dispatch: () => Promise<{ state: string }>
  isStopping: () => boolean
  isTransient: (error: unknown) => boolean
  wait: (ms: number) => Promise<void>
}
export async function runSharedLoop(deps: SharedLoopDependencies): Promise<void> {
  while (!deps.isStopping()) {
    let result: { state: string }
    try { result = await deps.dispatch() }
    catch (error) {
      if (!deps.isTransient(error)) throw error
      await deps.wait(1000)
      continue
    }
    if (!result || !['idle','contended','verified','needs_intervention'].includes(result.state)) throw new Error('shared_dispatch_result_invalid')
    if (result.state === 'idle' || result.state === 'contended') await deps.wait(1000)
  }
}
