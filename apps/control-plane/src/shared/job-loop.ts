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
    const waiting = ['idle','contended','waiting_commercial_reconcile']
    if (!result || ![...waiting,'verified','needs_intervention'].includes(result.state)) throw new Error('shared_dispatch_result_invalid')
    if (waiting.includes(result.state)) await deps.wait(1000)
  }
}

export type MaintenanceStep = { name: string; run: () => Promise<unknown> }
/** Runs the maintenance steps of one worker pass in order. A step that throws is logged (stack included) and the
 * remaining steps still run, so one broken step cannot stop payments, renewals or dunning for every customer.
 * A step that keeps failing is logged again on every pass. Nothing is skipped silently: only shutdown ends the pass early. */
export async function runMaintenanceSteps(steps: MaintenanceStep[], deps: { isStopping: () => boolean; log: (message: string, error?: unknown) => void }): Promise<void> {
  for (const step of steps) {
    if (deps.isStopping()) return
    try { await step.run() }
    catch (error) { deps.log(`maintenance step ${step.name} failed`, error) }
  }
}
