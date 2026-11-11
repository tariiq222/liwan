import { expect, it, vi } from 'vitest'
import { createMaintenanceRunner, MAINTENANCE_FAILURE_LOG_INTERVAL_MS, runSharedLoop, type MaintenanceStep } from './job-loop.js'

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

const runner=(steps:MaintenanceStep[],extra:{isStopping?:()=>boolean;log?:(message:string,error?:unknown)=>void;now?:()=>number}={})=>
  createMaintenanceRunner(steps,{isStopping:extra.isStopping??(()=>false),log:extra.log??(()=>{}),now:extra.now??(()=>0)})
it('a maintenance step that throws is logged with its error and the later steps still run',async()=>{
  const order:string[]=[]
  const boom=Error('candidate exploded')
  const log=vi.fn()
  await runner([
    {name:'onboarding-reconcile',run:async()=>{order.push('reconcile');throw boom}},
    {name:'commercial-scheduler',run:async()=>{order.push('tick')}},
    {name:'restore-publication',run:async()=>{order.push('restore')}},
  ],{log})()
  expect(order).toEqual(['reconcile','tick','restore'])
  expect(log).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith('maintenance step onboarding-reconcile failed',boom)
})
it('a step that keeps failing runs every pass but is logged once a minute with the count it held back',async()=>{
  let clock=0
  const log=vi.fn()
  const run=vi.fn(async()=>{throw Error('still broken')})
  const pass=runner([{name:'broken',run}],{log,now:()=>clock})
  await pass()
  for(let second=1;second<=59;second++){clock=second*1000;await pass()}
  expect(run).toHaveBeenCalledTimes(60)
  expect(log).toHaveBeenCalledTimes(1)
  clock=MAINTENANCE_FAILURE_LOG_INTERVAL_MS
  await pass()
  expect(log).toHaveBeenCalledTimes(2)
  expect(log.mock.calls[1]![0]).toBe('maintenance step broken is still failing (59 failures since the last log line)')
  expect(log.mock.calls[1]![1]).toBeInstanceOf(Error)
})
it('failing steps are rate limited separately and one recovery line is logged when a step works again',async()=>{
  let clock=0
  let healthy=false
  const log=vi.fn()
  const pass=runner([
    {name:'flaky',run:async()=>{if(!healthy)throw Error('down')}},
    {name:'broken',run:async()=>{throw Error('always')}},
  ],{log,now:()=>clock})
  await pass()
  clock=1000;await pass()
  expect(log.mock.calls.map(call=>call[0])).toEqual(['maintenance step flaky failed','maintenance step broken failed'])
  healthy=true;clock=2000;await pass();await pass()
  expect(log.mock.calls.map(call=>call[0])).toEqual(['maintenance step flaky failed','maintenance step broken failed','maintenance step flaky recovered; 1 failures since the last log line were not logged'])
  healthy=false;clock=3000;await pass()
  expect(log.mock.calls.at(-1)![0]).toBe('maintenance step flaky failed')
})
it('stops starting steps once shutdown is requested',async()=>{
  let stopping=false
  const second=vi.fn()
  await runner([{name:'first',run:async()=>{stopping=true}},{name:'second',run:second}],{isStopping:()=>stopping})()
  expect(second).not.toHaveBeenCalled()
})
