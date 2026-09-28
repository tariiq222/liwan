import { beforeEach, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { runSharedWorker } from './job-runner.js'
import { dispatchSharedOnce } from './job-dispatcher.js'
vi.mock('./job-dispatcher.js',()=>({dispatchSharedOnce:vi.fn()}))
beforeEach(()=>vi.resetAllMocks())
const pool={} as Pool
const adapter={observe:vi.fn(),applyFenced:vi.fn()}
it('interrupts an already pending idle timer without claiming again',async()=>{
  vi.useFakeTimers()
  const abort=new AbortController()
  const remove=vi.spyOn(abort.signal,'removeEventListener')
  try {
    vi.mocked(dispatchSharedOnce).mockResolvedValue({state:'idle'})
    const running=runSharedWorker({pool,adapter,signal:abort.signal})
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    abort.abort()
    await running
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort',expect.any(Function))
    expect(dispatchSharedOnce).toHaveBeenCalledTimes(1)
  } finally {abort.abort();remove.mockRestore();vi.useRealTimers()}
})
it('backs off a classified database disconnect and aborts without another dispatch',async()=>{
  vi.useFakeTimers()
  const abort=new AbortController()
  try {
    vi.mocked(dispatchSharedOnce).mockRejectedValue(Object.assign(new Error('synthetic disconnect'),{code:'08006'}))
    const running=runSharedWorker({pool,adapter,signal:abort.signal})
    await vi.advanceTimersByTimeAsync(999)
    expect(dispatchSharedOnce).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    abort.abort();await running
    expect(vi.getTimerCount()).toBe(0)
    expect(dispatchSharedOnce).toHaveBeenCalledTimes(1)
  } finally {abort.abort();vi.useRealTimers()}
})
it('propagates non-transient SQL errors instead of retrying forever',async()=>{
  const error=Object.assign(new Error('synthetic invalid schema'),{code:'42703'})
  vi.mocked(dispatchSharedOnce).mockRejectedValue(error)
  await expect(runSharedWorker({pool,adapter,signal:new AbortController().signal})).rejects.toBe(error)
  expect(dispatchSharedOnce).toHaveBeenCalledTimes(1)
})
it('requires explicitly supplied adapter before dispatch',async()=>{
  await expect(runSharedWorker({pool,signal:new AbortController().signal})).rejects.toThrow('shared_adapter_unavailable')
  expect(dispatchSharedOnce).not.toHaveBeenCalled()
})
it('does not dispatch when already stopped',async()=>{
  const abort=new AbortController();abort.abort()
  await runSharedWorker({pool,adapter,signal:abort.signal})
  expect(dispatchSharedOnce).not.toHaveBeenCalled()
})
it('composes dispatcher with the exact pool and adapter and wakes idle shutdown',async()=>{
  const abort=new AbortController()
  vi.mocked(dispatchSharedOnce).mockImplementation(async()=>{
    queueMicrotask(()=>abort.abort())
    return {state:'idle'}
  })
  await runSharedWorker({pool,adapter,signal:abort.signal})
  expect(dispatchSharedOnce).toHaveBeenCalledExactlyOnceWith(pool,adapter)
})
