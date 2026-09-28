import { expect, it, vi } from 'vitest'
import { runSharedLoop } from './job-loop.js'

it('waits on idle and contention, then stops without another dispatch', async () => {
  let ticks=0
  const dispatch=vi.fn(async()=>({state:++ticks===1?'idle':'contended'}))
  const wait=vi.fn(async()=>{})
  await runSharedLoop({dispatch,wait,isStopping:()=>ticks===2,isTransient:()=>false})
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(wait.mock.calls).toEqual([[1000],[1000]])
})
it('backs off transient database outage before retrying selection', async () => {
  let ticks=0
  const dispatch=vi.fn(async()=>{if(++ticks===1)throw Error('db_down');return {state:'verified'}})
  const wait=vi.fn(async()=>{})
  await runSharedLoop({dispatch,wait,isStopping:()=>ticks===2,isTransient:error=>error instanceof Error&&error.message==='db_down'})
  expect(wait.mock.calls).toEqual([[1000]])
})
it('propagates non-transient failures without silently retrying effects', async () => {
  const dispatch=vi.fn(async()=>{throw Error('effect_unknown')})
  const wait=vi.fn(async()=>{})
  await expect(runSharedLoop({dispatch,wait,isStopping:()=>false,isTransient:()=>false})).rejects.toThrow('effect_unknown')
  expect(dispatch).toHaveBeenCalledTimes(1);expect(wait).not.toHaveBeenCalled()
})
it('rejects an unknown dispatch result instead of spinning silently', async () => {
  const dispatch=vi.fn(async()=>({state:'unexpected'}))
  const wait=vi.fn(async()=>{})
  await expect(runSharedLoop({dispatch,wait,isStopping:()=>dispatch.mock.calls.length>1,isTransient:()=>false})).rejects.toThrow('shared_dispatch_result_invalid')
  expect(dispatch).toHaveBeenCalledTimes(1)
})
it('finishes in-flight dispatch then honors shutdown before another claim', async () => {
  let stopping=false
  const dispatch=vi.fn(async()=>{stopping=true;return {state:'needs_intervention'}})
  await runSharedLoop({dispatch,wait:vi.fn(),isStopping:()=>stopping,isTransient:()=>false})
  expect(dispatch).toHaveBeenCalledTimes(1)
})
