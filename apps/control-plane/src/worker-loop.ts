import type { Claimed } from './worker.js'

export type WorkerLoopDependencies = {
  isStopping: () => boolean
  expire: () => Promise<unknown>
  claim: () => Promise<Claimed | null>
  execute: (claim: Claimed) => Promise<void>
  isTransient: (error: unknown) => boolean
  wait: (ms: number) => Promise<void>
}

export async function runWorkerLoop(deps: WorkerLoopDependencies): Promise<void> {
  while (!deps.isStopping()) {
    let claimed: Claimed | null
    try {
      await deps.expire()
      claimed = await deps.claim()
    } catch (error) {
      if (!deps.isTransient(error)) throw error
      await deps.wait(1000)
      continue
    }

    if (claimed) await deps.execute(claimed)
    else await deps.wait(1000)
  }
}
