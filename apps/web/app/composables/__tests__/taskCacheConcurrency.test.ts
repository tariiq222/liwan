import { beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'
import { reconcileTaskWriteEvent, useTasks, useUpdateTask, useCreateTask, useTransitionTask, useRequestTaskCompletion, useAcceptTaskCompletion, useReturnTaskCompletion, useWithdrawTaskCompletion, useArchiveTask, taskKeys, type TaskListParams } from '../useTasks'
import { useProjectDashboardAnalytics } from '../useProjectDashboardAnalytics'
import { ApiError } from '../useApi'
import { scheduleKeys, useUpdateProjectScheduleTask } from '../useProjectSchedule'
import { governanceKeys } from '../projectGovernanceKeys'
import { baselineKeys } from '../projectBaselineKeys'
import { changeKeys } from '../projectChangeKeys'
import { projectKeys } from '../projectKeys'
import { openTasksAttention } from '../../modules/pmo/attention'

type CachedTaskPages = { pages: Array<{ items: Array<{ id: number; name: string; priority: string }>; total: number }>; pageParams: number[] }

const state = vi.hoisted(() => ({ qc: null as any, options: {} as any, me: null as any, query: null as any }))
vi.mock('@tanstack/vue-query', async importOriginal => ({ ...await importOriginal<any>(), useQueryClient: () => state.qc, useQuery: (options: any) => { state.query = options; return options }, useInfiniteQuery: (options: any) => { state.query = options; return options }, useMutation: (options: any) => { state.options = options; return options } }))
beforeEach(() => {
  vi.stubGlobal('computed', computed)
  state.me = ref({ id: 1, company: { id: 2 } })
  vi.stubGlobal('useMe', () => ({ me: state.me }))
  state.qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }))
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
})
it('a failed task A restores only its row, preserving a confirmed task B', async () => {
  const key = ['tasks', 'list', { closed: false }]
  const a = { id: 1, name: 'A', priority: '0' }, b = { id: 2, name: 'B', priority: '0' }
  state.qc.setQueryData(key, { pages: [{ items: [a, b], total: 2 }], pageParams: [0] })
  useUpdateTask()
  const m = state.options
  const av = { id: 1, patch: { priority: '1' } }, bv = { id: 2, patch: { priority: '2' } }
  const actx = await m.onMutate(av), bctx = await m.onMutate(bv)
  await m.onSuccess({ ...b, priority: '2' }, bv, bctx)
  m.onError(new Error('refused'), av, actx)
  expect(state.qc.getQueryData(key).pages[0].items).toEqual([a, { ...b, priority: '2' }])
  state.qc.clear()
})
it('ordinary priority writes avoid replaying an unfiltered history and project followers', async () => {
  const qc = state.qc as QueryClient
  qc.setQueryData(['tasks', 'list', { closed: false }], { pages: [{ items: [{ id: 1, priority: '0' }], total: 1 }], pageParams: [0] })
  qc.setQueryData(['projects', 'detail', 5, 'followers'], {})
  useUpdateTask()
  const m = state.options, variables = { id: 1, patch: { priority: '2' } }
  const ctx = await m.onMutate(variables)
  m.onSuccess({ id: 1, priority: '2' }, variables, ctx)
  m.onSettled({}, null, variables, ctx)
  expect(qc.getQueryState(['tasks', 'list', { closed: false }])?.isInvalidated).toBe(false)
  expect(qc.getQueryState(['projects', 'detail', 5, 'followers'])?.isInvalidated).toBe(false)
  qc.clear()
})
it('rebases two failed edits of the same task back to the original row', async () => {
  const key = ['tasks', 'list', { closed: false }], original = { id: 1, name: 'Original', priority: '0' }
  state.qc.setQueryData(key, { pages: [{ items: [original], total: 1 }], pageParams: [0] })
  useUpdateTask()
  const m = state.options
  const av = { id: 1, patch: { priority: '1' } }, bv = { id: 1, patch: { name: 'New' } }
  const a = await m.onMutate(av), b = await m.onMutate(bv)
  m.onError(new Error('A'), av, a); m.onSettled(undefined, new Error('A'), av, a)
  expect(state.qc.getQueryData(key).pages[0].items[0]).toEqual({ ...original, name: 'New' })
  m.onError(new Error('B'), bv, b); m.onSettled(undefined, new Error('B'), bv, b)
  expect(state.qc.getQueryData(key).pages[0].items[0]).toEqual(original)
  state.qc.clear()
})
it('serializes writes of the same task across hook instances', async () => {
  const releases: Array<(value: any) => void> = [], calls: string[] = []
  vi.stubGlobal('useApi', () => ({ $api: (_path: string, options: any) => { calls.push(options.body.name); return new Promise(resolve => releases.push(resolve)) } }))
  useUpdateTask(); const first = state.options
  useUpdateTask(); const second = state.options
  const a = first.mutationFn({ id: 1, patch: { name: 'A' } })
  const b = second.mutationFn({ id: 1, patch: { name: 'B' } })
  await Promise.resolve(); await Promise.resolve()
  expect(calls).toEqual(['A'])
  releases.shift()!({ id: 1, name: 'A' }); await a; await Promise.resolve(); await Promise.resolve()
  expect(calls).toEqual(['A', 'B'])
  releases.shift()!({ id: 1, name: 'B' }); await b
  state.qc.clear()
})
it('refreshes a filtered priority list and a write-date ordered list while keeping default id order', async () => {
  const qc = state.qc as QueryClient
  const params = [{ closed: false }, { closed: false, priority: ['1'] }, { closed: false, sort: 'write_date desc' }]
  params.forEach(p => qc.setQueryData(['tasks', 'list', p], { pages: [{ items: [{ id: 1, priority: '0' }], total: 1 }], pageParams: [0] }))
  useUpdateTask(); const m = state.options, variables = { id: 1, patch: { priority: '1' } }
  const ctx = await m.onMutate(variables)
  m.onSuccess({ id: 1, priority: '1' }, variables, ctx)
  m.onSettled({ id: 1, priority: '1' }, null, variables, ctx)
  expect(params.map(p => qc.getQueryState(['tasks', 'list', p])?.isInvalidated)).toEqual([false, true, true])
  qc.clear()
})
it('refuses a queued task write after the cached user or company changes', async () => {
  const qc = state.qc as QueryClient
  qc.setQueryData(['me'], { id: 1, company: { id: 2 } })
  let release!: (value: unknown) => void
  const api = vi.fn(() => new Promise(resolve => { release = resolve }))
  vi.stubGlobal('useApi', () => ({ $api: api }))
  useUpdateTask(); const m = state.options
  const a = m.mutationFn({ id: 1, patch: { name: 'A' } })
  const b = m.mutationFn({ id: 1, patch: { name: 'B' } })
  const denied = expect(b).rejects.toMatchObject({ code: 'identity_changed' })
  await Promise.resolve(); await Promise.resolve()
  state.me.value = { id: 3, company: { id: 4 } }
  release({ id: 1, name: 'A' }); await a; await denied
  expect(api).toHaveBeenCalledTimes(1)
  qc.clear()
})
it('keeps a new company edit separate from the previous company pending layer', async () => {
  const qc = state.qc as QueryClient, key = ['tasks', 'list', { closed: false }]
  const variables = { id: 1, patch: { name: 'Old pending' } }
  qc.setQueryData(key, { pages: [{ items: [{ id: 1, name: 'Old company', priority: '0' }], total: 1 }], pageParams: [0] })
  useUpdateTask(); const m = state.options
  const old = await m.onMutate(variables)
  state.me.value = { id: 1, company: { id: 3 } }
  qc.clear()
  qc.setQueryData(key, { pages: [{ items: [{ id: 1, name: 'New company', priority: '0' }], total: 1 }], pageParams: [0] })
  const newer = { id: 1, patch: { priority: '2' } }, context = await m.onMutate(newer)
  m.onSuccess({ id: 1, name: 'Old pending', priority: '0' }, variables, old)
  m.onSettled(undefined, null, variables, old)
  expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]).toEqual({ id: 1, name: 'New company', priority: '2' })
  m.onError(new Error('refused'), newer, context)
  expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]).toEqual({ id: 1, name: 'New company', priority: '0' })
  qc.clear()
})
it('reapplies a pending task edit to a list read started by another task settlement', async () => {
  const qc = state.qc as QueryClient, params = { closed: false }, key = ['tasks', 'list', params]
  const row = { id: 2, name: 'B', priority: '0' }
  qc.setQueryData(key, { pages: [{ items: [row], total: 1 }], pageParams: [0] })
  useUpdateTask(); const m = state.options
  const variables = { id: 2, patch: { priority: '2' } }
  const context = await m.onMutate(variables)
  vi.stubGlobal('useApi', () => ({ $api: vi.fn(async () => ({ items: [row], total: 1 })) }))
  useTasks(ref(params))
  const result = await state.query.queryFn({ queryKey: key, pageParam: 0, signal: new AbortController().signal })
  expect(result.items).toEqual([{ ...row, priority: '2' }])
  m.onError(new Error('refused'), variables, context)
  expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items).toEqual([row])
  qc.clear()
})
it('rolls back an optimistic row in a newly fetched query key after its write fails', async () => {
  const qc = state.qc as QueryClient, original = { id: 2, name: 'B', priority: '0' }
  const firstParams = { closed: false }, firstKey = ['tasks', 'list', firstParams]
  qc.setQueryData(firstKey, { pages: [{ items: [original], total: 1 }], pageParams: [0] })
  useUpdateTask(); const mutation = state.options, variables = { id: 2, patch: { priority: '2' } }
  const context = await mutation.onMutate(variables)
  const params = { closed: false, q: 'B' }, newKey = ['tasks', 'list', params]
  vi.stubGlobal('useApi', () => ({ $api: vi.fn(async () => ({ items: [original], total: 1 })) }))
  useTasks(ref(params))
  await qc.fetchInfiniteQuery({ ...state.query, queryKey: newKey })
  expect(qc.getQueryData<CachedTaskPages>(newKey)?.pages[0]?.items[0]?.priority).toBe('2')
  mutation.onError(new Error('refused'), variables, context)
  mutation.onSettled(undefined, new Error('refused'), variables, context)
  expect(qc.getQueryData<CachedTaskPages>(newKey)?.pages[0]?.items).toEqual([original])
  qc.clear()
})

it.each([true, false])('a local deadline edit refreshes live project derivations only (known project=%s)', async known => {
  const qc = state.qc as QueryClient
  const keys = [
    ['projects', 'detail', 5, 'evm'], ['projects', 'detail', 5, 'baselines', 'variance'],
    ['projects', 'detail', 5, 'baselines', 'list', {}], ['projects', 'detail', 5, 'baselines', 'item', 1],
    ['projects', 'detail', 5, 'followers'], ['projects', 'detail', 5, 'updates'], ['projects', 'settings'],
    ['projects', 'detail', 8, 'evm'], ['projects', 'detail', 8, 'baselines', 'variance'],
  ]
  const reads = keys.map(() => vi.fn(async () => ({ revision: 'after' })))
  keys.forEach(key => qc.setQueryData(key, { revision: 'before' }))
  const stops = keys.map((queryKey, index) => new QueryObserver(qc, { queryKey, staleTime: Infinity, queryFn: reads[index] }).subscribe(() => {}))
  try {
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch: { date_deadline: '2026-12-01' } }
    const ctx = await mutation.onMutate(variables)
    const detail = { id: 1, project: known ? { id: 5 } : null, date_deadline: '2026-12-01' }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(reads.map(read => read.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0, 0, known ? 0 : 1, known ? 0 : 1]))
    expect(qc.getQueryData(keys[0]!)).toEqual({ revision: 'after' })
    expect(qc.getQueryData(keys[1]!)).toEqual({ revision: 'after' })
  } finally { stops.forEach(stop => stop()); qc.clear() }
})

it.each([
  { started: 'before mutation', outcome: 'success' },
  { started: 'during PATCH', outcome: 'success' },
  { started: 'before mutation', outcome: 'failure' },
  { started: 'during PATCH', outcome: 'failure' },
])('completes a cold filtered list started $started after PATCH $outcome', async ({ started, outcome }) => {
  const qc = state.qc as QueryClient
  const original = { id: 1, name: 'A', priority: '0' }
  const firstKey = ['tasks', 'list', { closed: false }]
  qc.setQueryData(firstKey, { pages: [{ items: [original], total: 1 }], pageParams: [0] })
  let release!: (value: object) => void
  const oldRead = new Promise<object>(resolve => { release = resolve })
  let serverPriority = '0'
  const api = vi.fn().mockImplementationOnce(() => oldRead).mockImplementation(async () => ({ items: [{ ...original, priority: serverPriority }], total: 1 }))
  vi.stubGlobal('useApi', () => ({ $api: api }))
  const params = { closed: false, q: 'A' }, key = ['tasks', 'list', params]
  useTasks(ref(params)); const query = state.query
  const observer = new QueryObserver(qc, { queryKey: key, retry: false, staleTime: Infinity, queryFn: async context => ({ pages: [await query.queryFn({ ...context, pageParam: 0 })], pageParams: [0] }) })
  let stop = () => {}
  useUpdateTask(); const mutation = state.options, variables = { id: 1, patch: { priority: '2' } }
  try {
    if (started === 'before mutation') {
      stop = observer.subscribe(() => {})
      await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    }
    const ctx = await mutation.onMutate(variables)
    if (started === 'during PATCH') {
      stop = observer.subscribe(() => {})
      await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    }
    if (outcome === 'success') {
      serverPriority = '2'
      const detail = { ...original, priority: serverPriority }
      mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    } else {
      const error = new Error('refused')
      mutation.onError(error, variables, ctx); mutation.onSettled(undefined, error, variables, ctx)
    }
    if (outcome === 'success' || started === 'before mutation') {
      await vi.waitFor(() => expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]?.priority).toBe(serverPriority))
      expect(api).toHaveBeenCalledTimes(2)
    }
    // Deliver the obsolete snapshot after the authoritative replacement read.
    release({ items: [original], total: 1 })
    await vi.waitFor(() => expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]?.priority).toBe(serverPriority))
    await Promise.resolve(); await Promise.resolve()
    expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]?.priority).toBe(serverPriority)
    expect(observer.getCurrentResult().isSuccess).toBe(true)
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(qc.getQueryData<CachedTaskPages>(firstKey)?.pages[0]?.items[0]?.priority).toBe(serverPriority)
  } finally { stop(); qc.clear() }
})

it('does not restart or replace a cold list owned by a different company after old mutation callbacks', async () => {
  const qc = state.qc as QueryClient, params = { closed: false, q: 'A' }, key = ['tasks', 'list', params]
  const releases: Array<(value: object) => void> = []
  const api = vi.fn(() => new Promise<object>(resolve => { releases.push(resolve) }))
  vi.stubGlobal('useApi', () => ({ $api: api }))
  useTasks(ref(params)); const query = state.query
  const observe = () => new QueryObserver(qc, { queryKey: key, retry: false, queryFn: async context => ({ pages: [await query.queryFn({ ...context, pageParam: 0 })], pageParams: [0] }) }).subscribe(() => {})
  const oldStop = observe()
  useUpdateTask(); const mutation = state.options, variables = { id: 1, patch: { priority: '2' } }
  const ctx = await mutation.onMutate(variables)
  oldStop(); qc.clear()
  state.me.value = { id: 1, company: { id: 3 } }
  const stop = observe()
  try {
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    mutation.onSuccess({ id: 1, priority: '2' }, variables, ctx)
    mutation.onSettled({ id: 1, priority: '2' }, null, variables, ctx)
    releases[1]!({ items: [{ id: 1, name: 'A', priority: '3' }], total: 1 })
    await vi.waitFor(() => expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]?.priority).toBe('3'))
    releases[0]!({ items: [{ id: 1, name: 'A', priority: '0' }], total: 1 })
    await Promise.resolve(); await Promise.resolve()
    expect(api).toHaveBeenCalledTimes(2)
    expect(qc.getQueryData<CachedTaskPages>(key)?.pages[0]?.items[0]?.priority).toBe('3')
    expect(qc.getQueryData(['tasks', 'detail', 1])).toBeUndefined()
  } finally { stop(); qc.clear() }
})

it('refreshes live readings for a task rename before acknowledging it without replaying project governance', async () => {
  const qc = state.qc as QueryClient
  const keys = [
    ['projects', 'list'], ['projects', 'detail', 5], ['projects', 'detail', 5, 'stages'], ['projects', 'detail', 5, 'milestones'],
    ['projects', 'detail', 5, 'evm'], ['projects', 'detail', 5, 'baselines', 'variance'],
    ['projects', 'detail', 5, 'followers'], ['projects', 'detail', 5, 'baselines', 'item', 1],
  ]
  const releases: Array<(value: object) => void> = []
  const reads = keys.map(() => vi.fn(() => new Promise<object>(resolve => { releases.push(resolve) })))
  keys.forEach(key => qc.setQueryData(key, { revision: 'before' }))
  const stops = keys.map((queryKey, index) => new QueryObserver(qc, { queryKey, staleTime: Infinity, queryFn: reads[index] }).subscribe(() => {}))
  try {
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch: { name: 'Renamed' } }
    const ctx = await mutation.onMutate(variables)
    const detail = { id: 1, name: 'Renamed', project: { id: 5 }, updated_at: '2026-11-07T00:00:00.123456Z' }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(reads.map(read => read.mock.calls.length)).toEqual([0, 0, 0, 0, 1, 1, 0, 0]))
    let acknowledged = false
    const acknowledgement = reconcileTaskWriteEvent(qc, { id: 1, event: 'updated', source: 'write', updated_at: detail.updated_at, changed_fields: ['name'] }).then(result => { acknowledged = result; return result })
    await Promise.resolve(); await Promise.resolve()
    expect(acknowledged).toBe(false)
    releases.forEach(release => release({ revision: 'after' }))
    await expect(acknowledgement).resolves.toBe(true)
    expect(qc.getQueryData(keys[5]!)).toEqual({ revision: 'after' })
    expect(qc.getQueryData(keys[7]!)).toEqual({ revision: 'before' })
  } finally { stops.forEach(stop => stop()); qc.clear() }
})

it.each([403, 422])('does not replay a settled cold %s refusal after an unrelated priority save', async status => {
  const qc = state.qc as QueryClient, params = { closed: false, q: 'Restricted' }, key = ['tasks', 'list', params]
  const refusal = new ApiError(status, status === 403 ? 'forbidden' : 'invalid', 'Refused')
  const api = vi.fn().mockRejectedValue(refusal)
  vi.stubGlobal('useApi', () => ({ $api: api }))
  useTasks(ref(params)); const query = state.query
  const observer = new QueryObserver(qc, { queryKey: key, retry: false, queryFn: async context => ({ pages: [await query.queryFn({ ...context, pageParam: 0 })], pageParams: [0] }) })
  const stop = observer.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'))
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(api).toHaveBeenCalledTimes(1)
    useUpdateTask(); const mutation = state.options, variables = { id: 2, patch: { priority: '2' } }
    const ctx = await mutation.onMutate(variables)
    const detail = { id: 2, name: 'Unrelated', priority: '2' }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'))
    expect(observer.getCurrentResult().error).toBe(refusal)
    expect(observer.getCurrentResult().status).toBe('error')
    expect(api).toHaveBeenCalledTimes(1)
  } finally { stop(); qc.clear() }
})

const projectTaskPatchCases = [
  { field: 'name', patch: { name: 'Renamed' }, schedule: 1, taskPage: 1, taskRef: 1 },
  { field: 'description', patch: { description: 'Note' }, schedule: 0, taskPage: 1, taskRef: 0 },
  { field: 'date_deadline', patch: { date_deadline: '2026-12-01' }, schedule: 1, taskPage: 1, taskRef: 0 },
  { field: 'priority', patch: { priority: '2' }, schedule: 0, taskPage: 1, taskRef: 0 },
  { field: 'user_ids', patch: { user_ids: [2] }, schedule: 1, taskPage: 1, taskRef: 1 },
  { field: 'tag_ids', patch: { tag_ids: [3] }, schedule: 0, taskPage: 1, taskRef: 0 },
  { field: 'personal_stage_type_id', patch: { personal_stage_type_id: 4 }, schedule: 0, taskPage: 1, taskRef: 0 },
  { field: 'allocated_hours', patch: { allocated_hours: 8 }, schedule: 0, taskPage: 0, taskRef: 0 },
  { field: 'stage_id', patch: { stage_id: 4 }, schedule: 1, taskPage: 1, taskRef: 0 },
  { field: 'milestone_id', patch: { milestone_id: 4 }, schedule: 1, taskPage: 0, taskRef: 0 },
  { field: 'deliverables', patch: { deliverables: [{ name: 'Deliver', done: true }] }, schedule: 0, taskPage: 0, taskRef: 0 },
  { field: 'percent_complete', patch: { percent_complete: 50 }, schedule: 0, taskPage: 0, taskRef: 0 },
]
it.each(projectTaskPatchCases.flatMap(test => [true, false].map(known => ({ ...test, known }))))('a $field edit refreshes its live project task fields only (known=$known)', async ({ patch, schedule, taskPage, taskRef, known }) => {
  const qc = state.qc as QueryClient
  const keys = [
    scheduleKeys.detail(5), [...governanceKeys.all(5), 'task-page', { closed: false, offset: 0 }],
    governanceKeys.raci(5), governanceKeys.register(5, {}), governanceKeys.registerItem(5, 1),
    governanceKeys.stakeholders(5, {}), governanceKeys.stakeholder(5, 1), changeKeys.list(5, {}),
    baselineKeys.list(5, {}), baselineKeys.item(5, 1), projectKeys.followers(5), projectKeys.updates(5), projectKeys.minimal,
    scheduleKeys.detail(8), [...governanceKeys.all(8), 'task-page', { closed: false, offset: 0 }],
  ]
  const reads = keys.map(() => vi.fn(async () => ({ revision: 'current' })))
  keys.forEach(key => qc.setQueryData(key, { revision: 'before' }))
  const stops = keys.map((queryKey, index) => new QueryObserver(qc, { queryKey, staleTime: Infinity, queryFn: reads[index] }).subscribe(() => {}))
  try {
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch }
    const ctx = await mutation.onMutate(variables)
    const detail = { id: 1, ...patch, project: known ? { id: 5 } : null }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(reads.map(read => read.mock.calls.length)).toEqual([schedule, taskPage, taskRef, taskRef, taskRef, 0, 0, 0, 0, 0, 0, 0, 0, known ? 0 : schedule, known ? 0 : taskPage]))
  } finally { stops.forEach(stop => stop()); qc.clear() }
})
it.each([
  { patch: { name: 'Renamed' }, field: 'name' },
  { patch: { date_deadline: '2026-12-01' }, field: 'date_deadline' },
])('waits for the scheduled $field response before consuming the local write event', async ({ patch, field }) => {
  const qc = state.qc as QueryClient, key = scheduleKeys.detail(5)
  qc.setQueryData(key, { revision: 'before' })
  let release!: (value: object) => void
  const read = vi.fn(() => new Promise<object>(resolve => { release = resolve }))
  const stop = new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: read }).subscribe(() => {})
  try {
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch }
    const ctx = await mutation.onMutate(variables)
    const detail = { id: 1, ...patch, project: { id: 5 }, updated_at: '2026-11-07T01:00:00.123456Z' }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    let acknowledged = false
    const pending = reconcileTaskWriteEvent(qc, { id: 1, event: 'updated', source: 'write', updated_at: detail.updated_at, changed_fields: [field] }).then(result => { acknowledged = result; return result })
    await Promise.resolve(); await Promise.resolve()
    expect(acknowledged).toBe(false)
    release({ revision: 'current' })
    await expect(pending).resolves.toBe(true)
    expect(qc.getQueryData(key)).toEqual({ revision: 'current' })
  } finally { stop(); qc.clear() }
})

it.each([
  ['create', useCreateTask], ['transition', useTransitionTask], ['request completion', useRequestTaskCompletion],
  ['accept completion', useAcceptTaskCompletion], ['return completion', useReturnTaskCompletion],
  ['withdraw completion', useWithdrawTaskCompletion], ['archive', useArchiveTask],
] as const)('the canonical analytics cache refreshes after a task %s', async (_action, useMutation) => {
  const qc = state.qc as QueryClient
  useProjectDashboardAnalytics(ref({ q: 'Company', status: 'at_risk' as const }))
  const key = state.query.queryKey.value
  expect(key).toEqual(['projects', 'analytics', { q: 'Company', status: 'at_risk' }])
  qc.setQueryData(key, { revision: 'before' })
  const read = vi.fn(async () => ({ revision: 'current' }))
  const stop = new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: read }).subscribe(() => {})
  try {
    useMutation(); state.options.onSuccess({ id: 1 }, { id: 1 })
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual({ revision: 'current' }))
    expect(read).toHaveBeenCalledTimes(1)
  } finally { stop(); qc.clear() }
})

it('a schedule edit refreshes scoped live derivations and canonical analytics without waiting for the bus', async () => {
  const qc = state.qc as QueryClient
  useProjectDashboardAnalytics(ref({}))
  const analyticsKey = state.query.queryKey.value
  const keys = [scheduleKeys.detail(5), baselineKeys.variance(5), analyticsKey,
    [...governanceKeys.all(5), 'task-page', { closed: false, offset: 0 }],
    scheduleKeys.detail(8), baselineKeys.variance(8), projectKeys.followers(5),
    governanceKeys.stakeholders(5, {}), changeKeys.list(5, {}), baselineKeys.list(5, {})]
  const reads = keys.map(() => vi.fn(async () => ({ revision: 'current' })))
  keys.forEach(key => qc.setQueryData(key, { revision: 'before' }))
  const stops = keys.map((queryKey, index) => new QueryObserver(qc, { queryKey, staleTime: Infinity, queryFn: reads[index] }).subscribe(() => {}))
  try {
    useUpdateProjectScheduleTask()
    await state.options.onSuccess({ id: 1 }, { projectId: 5, taskId: 1, patch: { start: '2026-12-01', end: '2026-12-10' } })
    expect(reads.map(read => read.mock.calls.length)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
  } finally { stops.forEach(stop => stop()); qc.clear() }
})

it.each(['date_deadline', 'user_ids'] as const)('a local $field edit refreshes canonical analytics with its current filters', async field => {
  const qc = state.qc as QueryClient
  useProjectDashboardAnalytics(ref({ q: 'Company', status: 'at_risk' as const }))
  const key = state.query.queryKey.value
  qc.setQueryData(key, { revision: 'before' })
  const read = vi.fn(async () => ({ revision: 'current' }))
  const stop = new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: read }).subscribe(() => {})
  try {
    const patch = field === 'date_deadline' ? { date_deadline: '2026-12-01' } : { user_ids: [2] }
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch }, ctx = await mutation.onMutate(variables)
    const detail = { id: 1, ...patch, project: { id: 5 } }
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual({ revision: 'current' }))
    expect(read).toHaveBeenCalledTimes(1)
  } finally { stop(); qc.clear() }
})

// Stock project.task._compute_state (385-400) depends on stage_id; Liwan keeps
// that compute for planning-enabled projects (task_schedule.py:78-85).
it.each([
  { before: 'approved', after: 'in_progress' },
  { before: 'changes_requested', after: 'waiting' },
] as const)('reconciles stage-derived $before to $after membership, counts and schedule state', async ({ before, after }) => {
  const qc = state.qc as QueryClient
  const params: TaskListParams = { closed: false, state: [before] }
  const filteredKey = taskKeys.list(params), defaultKey = taskKeys.list({ closed: false }), summaryKey = taskKeys.summary(params)
  const scheduleKey = scheduleKeys.detail(5), attentionKey = openTasksAttention.queryKey
  const original = { id: 1, name: 'A', priority: '0', state: before, stage: { id: 3, name: 'Old' }, project: { id: 5 } }
  const detail = { ...original, state: after, stage: { id: 4, name: 'Next' } }
  const oldPages = { pages: [{ items: [original], total: 1 }], pageParams: [0] }
  qc.setQueryData(filteredKey, oldPages); qc.setQueryData(defaultKey, oldPages)
  qc.setQueryData(summaryKey, { total: 1, open: 1, overdue: 0, done: 0 })
  qc.setQueryData(scheduleKey, { tasks: [{ id: 1, state: before }] })
  qc.setQueryData(attentionKey, { items: [original], total: 1 })
  const filteredRead = vi.fn(async () => ({ pages: [{ items: [], total: 0 }], pageParams: [0] }))
  const summaryRead = vi.fn(async () => ({ total: 0, open: 0, overdue: 0, done: 0 }))
  const scheduleRead = vi.fn(async () => ({ tasks: [{ id: 1, state: after }] }))
  const attentionRead = vi.fn(async () => ({ items: [detail], total: 1 }))
  const defaultRead = vi.fn(async () => { throw new Error('Default id-order list needs no replay') })
  const stops = [
    new QueryObserver(qc, { queryKey: filteredKey, staleTime: Infinity, queryFn: filteredRead }).subscribe(() => {}),
    new QueryObserver(qc, { queryKey: defaultKey, staleTime: Infinity, queryFn: defaultRead }).subscribe(() => {}),
    new QueryObserver(qc, { queryKey: summaryKey, staleTime: Infinity, queryFn: summaryRead }).subscribe(() => {}),
    new QueryObserver(qc, { queryKey: scheduleKey, staleTime: Infinity, queryFn: scheduleRead }).subscribe(() => {}),
    new QueryObserver(qc, { queryKey: attentionKey, staleTime: Infinity, queryFn: attentionRead }).subscribe(() => {}),
  ]
  const unrelatedKeys = [projectKeys.followers(5), projectKeys.updates(5), governanceKeys.stakeholders(5, {}), changeKeys.list(5, {}), baselineKeys.item(5, 1), scheduleKeys.detail(8)]
  const unrelatedReads = unrelatedKeys.map(() => vi.fn(async () => ({ revision: 'changed' })))
  unrelatedKeys.forEach((key, index) => {
    qc.setQueryData(key, { revision: 'before' })
    stops.push(new QueryObserver(qc, { queryKey: key, staleTime: Infinity, queryFn: unrelatedReads[index] }).subscribe(() => {}))
  })
  try {
    useUpdateTask(); const mutation = state.options, variables = { id: 1, patch: { stage_id: 4 } }, ctx = await mutation.onMutate(variables)
    mutation.onSuccess(detail, variables, ctx); mutation.onSettled(detail, null, variables, ctx)
    await vi.waitFor(() => {
      expect(qc.getQueryData<{ pages: Array<{ items: unknown[]; total: number }> }>(filteredKey)?.pages[0]?.items).toEqual([])
      expect(qc.getQueryData(summaryKey)).toEqual({ total: 0, open: 0, overdue: 0, done: 0 })
      expect(qc.getQueryData(scheduleKey)).toEqual({ tasks: [{ id: 1, state: after }] })
      expect(qc.getQueryData(attentionKey)).toEqual({ items: [detail], total: 1 })
    })
    expect([filteredRead, summaryRead, scheduleRead, attentionRead].map(read => read.mock.calls.length)).toEqual([1, 1, 1, 1])
    expect(qc.getQueryData<{ pages: Array<{ items: Array<{ state: string }> }> }>(defaultKey)?.pages[0]?.items[0]?.state).toBe(after)
    expect(defaultRead).not.toHaveBeenCalled()
    expect(unrelatedReads.map(read => read.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0])
  } finally { stops.forEach(stop => stop()); qc.clear() }
})
