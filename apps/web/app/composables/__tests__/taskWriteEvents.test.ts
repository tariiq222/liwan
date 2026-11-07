import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'
import { useUpdateTask } from '../useTasks'
import { setBusQueryClient, useBus } from '../useBus'
const state = vi.hoisted(() => ({ qc: null as any, mutation: null as any }))
vi.mock('@tanstack/vue-query', async original => ({ ...await original<any>(), useQueryClient: () => state.qc, useMutation: (options: any) => { state.mutation = options; return options } }))
const revision = '2026-11-06T10:00:00.123456Z'
let socket: { onopen?: () => void; onmessage?: (e: { data: string }) => void }
const stops: Array<() => void> = []
const me = ref({ id: 1, company: { id: 2 } })
const list = ['tasks', 'list', { closed: false }]
const initial = [{ id: 1, name: 'A', priority: '0', updated_at: '2026-11-06T09:00:00.123456Z' }, { id: 2, name: 'B', priority: '0', updated_at: '2026-11-06T09:00:00.123456Z' }]
beforeEach(async () => {
  me.value = { id: 1, company: { id: 2 } }
  state.qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  state.qc.setQueryData(list, { pages: [{ items: initial, total: 2 }], pageParams: [0] })
  vi.stubGlobal('computed', computed); vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useApi', () => ({ $api: vi.fn() })); vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })); vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { wsUrl: '' } })); vi.stubGlobal('location', { protocol: 'https:', host: 'test' })
  vi.stubGlobal('$fetch', vi.fn(async () => ({ result: { websocket_worker_version: '19.0-2' } })))
  vi.stubGlobal('WebSocket', class { onopen?: () => void; onmessage?: (event: { data: string }) => void; constructor() { socket = this }; send() {}; close() {} })
  setBusQueryClient(state.qc); await useBus().connect(); socket.onopen?.()
})
afterEach(() => { useBus().disconnect(); stops.splice(0).forEach(stop => stop()); state.qc.clear(); vi.unstubAllGlobals() })
function observe() {
  const starts = vi.fn(async () => ({ pages: [{ items: initial, total: 2 }], pageParams: [0] }))
  stops.push(new QueryObserver(state.qc, { queryKey: list, queryFn: starts }).subscribe(() => {}))
  return starts
}
function send(extra: object = {}) {
  socket.onmessage!({ data: JSON.stringify([{ id: 1, message: { type: 'liwan/task', payload: { id: 1, event: 'updated', source: 'write', updated_at: revision, changed_fields: ['priority'], ...extra } } }]) })
}
async function edit(id = 1, patch: object = { priority: '2' }) {
  useUpdateTask(); const m = state.mutation, vars = { id, patch }, ctx = await m.onMutate(vars)
  return { m, vars, ctx, detail: { ...initial[id - 1], ...patch, updated_at: revision }, finish() { m.onSuccess(this.detail, vars, ctx); m.onSettled(this.detail, null, vars, ctx) } }
}
it('skips a redundant acknowledged write event after row cache and invalidations are applied', async () => {
  const starts = observe(), change = await edit(); change.finish()
  send(); await new Promise(r => setTimeout(r, 10))
  expect(starts).not.toHaveBeenCalled()
  expect(state.qc.getQueryData(list).pages[0].items[0].priority).toBe('2')
})
it('waits for the actual pending operation when the event arrives before the response', async () => {
  const starts = observe(), change = await edit()
  send(); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  change.finish(); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
})
it('does not mistake a freshly fetched detail for locally reconciled lists', async () => {
  const starts = observe()
  state.qc.setQueryData(['tasks', 'detail', 1], { ...initial[0], priority: '2', updated_at: revision })
  send(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it.each([
  [{ source: undefined, updated_at: undefined, changed_fields: undefined }, 'old event'],
  [{ source: undefined, changed_fields: undefined }, 'comment with the same revision'],
  [{ updated_at: '2026-11-06T10:00:00.123457Z' }, 'different remote revision'],
  [{ changed_fields: ['priority', 'state'] }, 'additional state change'],
])('conservatively refreshes %s (%s)', async (payload, _description) => {
  const starts = observe(), change = await edit(); change.finish()
  send(payload); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('rejects an old company acknowledgement after identity changes', async () => {
  const starts = observe(), change = await edit(); change.finish()
  me.value = { id: 1, company: { id: 3 } }
  send(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('settles A without overwriting B optimism or waiting for B', async () => {
  const starts = observe(), a = await edit(1), b = await edit(2)
  send(); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  a.finish(); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  expect(state.qc.getQueryData(list).pages[0].items.map((row: any) => row.priority)).toEqual(['2', '2'])
  b.m.onError(new Error('refused'), b.vars, b.ctx); b.m.onSettled(undefined, new Error('refused'), b.vars, b.ctx)
  expect(state.qc.getQueryData(list).pages[0].items.map((row: any) => row.priority)).toEqual(['2', '0'])
})
it('waits for the required filtered-list reconciliation before acknowledging its event', async () => {
  const starts = observe(), filtered = ['tasks', 'list', { closed: false, priority: ['2'] }]
  state.qc.setQueryData(filtered, { pages: [{ items: [], total: 0 }], pageParams: [0] })
  let release!: (value: unknown) => void
  const filteredStarts = vi.fn(() => new Promise(resolve => { release = resolve }))
  stops.push(new QueryObserver(state.qc, { queryKey: filtered, queryFn: filteredStarts }).subscribe(() => {}))
  const change = await edit(); change.finish()
  await vi.waitFor(() => expect(filteredStarts).toHaveBeenCalledTimes(1))
  send(); await new Promise(r => setTimeout(r, 10))
  expect(starts).not.toHaveBeenCalled(); expect(filteredStarts).toHaveBeenCalledTimes(1)
  release({ pages: [{ items: [change.detail], total: 1 }], pageParams: [0] })
  await new Promise(r => setTimeout(r, 10))
  expect(starts).not.toHaveBeenCalled(); expect(filteredStarts).toHaveBeenCalledTimes(1)
})
it('falls back when required reconciliation failed', async () => {
  const starts = observe(), filtered = ['tasks', 'list', { closed: false, priority: ['2'] }]
  state.qc.setQueryData(filtered, { pages: [{ items: [], total: 0 }], pageParams: [0] })
  const filteredStarts = vi.fn(async () => { throw new Error('offline') })
  stops.push(new QueryObserver(state.qc, { queryKey: filtered, queryFn: filteredStarts }).subscribe(() => {}))
  const change = await edit(); change.finish()
  await vi.waitFor(() => expect(filteredStarts).toHaveBeenCalledTimes(1))
  send(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('consumes acknowledgement once and keeps older repeated events conservative', async () => {
  const starts = observe(), change = await edit(); change.finish()
  send(); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  send(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('bounds completed acknowledgements and refreshes evicted revisions conservatively', async () => {
  const starts = observe()
  useUpdateTask(); const m = state.mutation
  for (let id = 1; id <= 129; id++) {
    const vars = { id, patch: { priority: '2' } }, ctx = await m.onMutate(vars), detail = { id, priority: '2', updated_at: revision }
    m.onSuccess(detail, vars, ctx); m.onSettled(detail, null, vars, ctx)
    await Promise.resolve(); await Promise.resolve()
  }
  send({ id: 129 }); await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  send({ id: 1 }); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('handles unrelated remote changes while another task in that frame awaits its response', async () => {
  const starts = observe(), a = await edit(1)
  socket.onmessage!({ data: JSON.stringify([
    { id: 1, message: { type: 'liwan/task', payload: { id: 1, event: 'updated', source: 'write', updated_at: revision, changed_fields: ['priority'] } } },
    { id: 2, message: { type: 'liwan/task', payload: { id: 2, event: 'updated' } } },
  ]) })
  await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
  a.finish(); await new Promise(r => setTimeout(r, 10))
  expect(starts).toHaveBeenCalledTimes(1)
})
it('discards completed acknowledgements across socket/session disconnect', async () => {
  const starts = observe(), change = await edit(); change.finish()
  await new Promise(r => setTimeout(r, 10))
  useBus().disconnect(); await useBus().connect(); socket.onopen?.()
  send(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
it('keeps a comment event conservative after a pending write response', async () => {
  const starts = observe(), change = await edit()
  send({ source: undefined, updated_at: undefined, changed_fields: undefined })
  await new Promise(r => setTimeout(r, 10)); expect(starts).not.toHaveBeenCalled()
  change.finish(); await vi.waitFor(() => expect(starts).toHaveBeenCalledTimes(1))
})
