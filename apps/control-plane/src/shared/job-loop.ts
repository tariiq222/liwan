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
/** A step that keeps failing is retried on every pass, but logged in full at most this often. */
export const MAINTENANCE_FAILURE_LOG_INTERVAL_MS = 60_000
type MaintenanceFailureState = { lastLoggedAt: number; suppressed: number }

/** Runs the maintenance steps of one worker pass in order. A step that throws is logged (stack included) and the
 * remaining steps still run, so one broken step cannot stop payments, renewals or dunning for every customer.
 * A failing step is retried on every pass; its first failure is logged at once, then at most once per
 * MAINTENANCE_FAILURE_LOG_INTERVAL_MS with the number of failures held back, and one line says when it works again.
 * The returned runner owns that per-step state for the life of the worker. Only shutdown ends a pass early. */
export function createMaintenanceRunner(steps: MaintenanceStep[], deps: { isStopping: () => boolean; log: (message: string, error?: unknown) => void; now: () => number }): () => Promise<void> {
  const failing = new Map<string, MaintenanceFailureState>()
  return async () => {
    for (const step of steps) {
      if (deps.isStopping()) return
      try {
        await step.run()
        const state = failing.get(step.name)
        if (state) {
          failing.delete(step.name)
          deps.log(`maintenance step ${step.name} recovered; ${state.suppressed} failures since the last log line were not logged`)
        }
      } catch (error) {
        const now = deps.now()
        const state = failing.get(step.name)
        if (!state) {
          failing.set(step.name, { lastLoggedAt: now, suppressed: 0 })
          deps.log(`maintenance step ${step.name} failed`, error)
        } else if (now - state.lastLoggedAt >= MAINTENANCE_FAILURE_LOG_INTERVAL_MS) {
          deps.log(`maintenance step ${step.name} is still failing (${state.suppressed} failures since the last log line)`, error)
          state.lastLoggedAt = now
          state.suppressed = 0
        } else state.suppressed++
      }
    }
  }
}
