import { expect, it, vi } from 'vitest'
import { runMaintenanceSteps, runSharedLoop } from './job-loop.js'

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
it('keeps the worker available after a restore waits for commercial reconciliation', async () => {
  let ticks=0
  const dispatch=vi.fn(async()=>({state:++ticks===1?'waiting_commercial_reconcile':'verified'}))
  const wait=vi.fn(async()=>{})
  await runSharedLoop({dispatch,wait,isStopping:()=>ticks===2,isTransient:()=>false})
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(wait.mock.calls).toEqual([[1000]])
})

it('a maintenance step that throws is logged with its error and the later steps still run',async()=>{
  const order:string[]=[]
  const boom=Error('candidate exploded')
  const log=vi.fn()
  await runMaintenanceSteps([
    {name:'onboarding-reconcile',run:async()=>{order.push('reconcile');throw boom}},
    {name:'commercial-scheduler',run:async()=>{order.push('tick')}},
    {name:'restore-publication',run:async()=>{order.push('restore')}},
  ],{isStopping:()=>false,log})
  expect(order).toEqual(['reconcile','tick','restore'])
  expect(log).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith('maintenance step onboarding-reconcile failed',boom)
})
it('a step that keeps failing is logged on every pass',async()=>{
  const log=vi.fn()
  const steps=[{name:'broken',run:async()=>{throw Error('still broken')}}]
  await runMaintenanceSteps(steps,{isStopping:()=>false,log})
  await runMaintenanceSteps(steps,{isStopping:()=>false,log})
  expect(log).toHaveBeenCalledTimes(2)
})
it('stops starting steps once shutdown is requested',async()=>{
  let stopping=false
  const second=vi.fn()
  await runMaintenanceSteps([{name:'first',run:async()=>{stopping=true}},{name:'second',run:second}],{isStopping:()=>stopping,log:vi.fn()})
  expect(second).not.toHaveBeenCalled()
})
