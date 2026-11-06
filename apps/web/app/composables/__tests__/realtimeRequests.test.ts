import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'
import { setBusQueryClient, useBus, chatTypingEvent } from '../useBus'

let socket: { onopen?: () => void; onmessage?: (e: { data: string }) => void }
const clients: QueryClient[] = []
afterEach(() => { useBus().disconnect(); clients.forEach(c => c.clear()); vi.unstubAllGlobals() })
async function setup(keys: unknown[][], firstRead?: () => Promise<object>) {
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { wsUrl: '' } }))
  vi.stubGlobal('location', { protocol: 'https:', host: 'liwan.test' })
  vi.stubGlobal('$fetch', vi.fn(async () => ({ result: { websocket_worker_version: '19.0-2' } })))
  vi.stubGlobal('WebSocket', class { onopen?: () => void; onmessage?: (event: { data: string }) => void; constructor() { socket = this }; send() {}; close() {} })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  clients.push(qc)
  const starts = keys.map(() => vi.fn(async () => ({})))
  if (firstRead) starts[0]!.mockImplementationOnce(firstRead)
  const observers = keys.map((queryKey, index) => new QueryObserver(qc, { queryKey, queryFn: starts[index] }))
  const stops = observers.map(o => o.subscribe(() => {}))
  await vi.waitFor(() => expect(starts.every(fn => fn.mock.calls.length === 1)).toBe(true))
  starts.forEach(fn => fn.mockClear())
  setBusQueryClient(qc)
  await useBus().connect()
  socket.onopen?.()
  return { qc, starts, stops, send: (type: string, payload: object) => socket.onmessage?.({ data: JSON.stringify([{ id: 1, message: { type, payload } }]) }) }
}
it('updates typing without starting any durable chat query', async () => {
  const { starts, send, stops } = await setup([['chat', 7, 'list'], ['chat', 7, 'detail', 3], ['chat', 7, 'messages', 3, {}]])
  send('liwan/chat', { id: 3, event: 'typing', user_id: 8, is_typing: true })
  expect(chatTypingEvent.value?.isTyping).toBe(true)
  await Promise.resolve()
  expect(starts.map(fn => fn.mock.calls.length)).toEqual([0, 0, 0])
  send('liwan/chat', { id: 3, event: 'typing', user_id: 8, is_typing: false })
  stops.forEach(stop => stop())
})
it('refreshes only the affected chat thread and lists', async () => {
  const { starts, send, stops } = await setup([['chat', 7, 'list'], ['chat', 7, 'messages', 3, {}], ['chat', 7, 'messages', 4, {}], ['chat', 7, 'recipients', '', 0]])
  send('liwan/chat', { id: 3, event: 'message_created' })
  await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0, 0]))
  stops.forEach(stop => stop())
})
it('keeps an unrelated inbox history and settings untouched', async () => {
  const { starts, send, stops } = await setup([['inbox', 'conversations'], ['inbox', 'messages', 3], ['inbox', 'messages', 4], ['inbox', 'canned-replies'], ['inbox', 'templates', 9]])
  send('liwan/inbox', { id: 3, event: 'conversation' })
  await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0, 0, 0]))
  stops.forEach(stop => stop())
})
it('template events refresh templates without replaying message history', async () => {
  const { starts, send, stops } = await setup([['inbox', 'messages', 3], ['inbox', 'templates', 9], ['inbox', 'template', 2]])
  send('liwan/inbox', { id: 2, event: 'template' })
  await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([0, 1, 1]))
  stops.forEach(stop => stop())
})
it('retains hidden-tab staleness and reconciles on return without background query starts', async () => {
  const listeners = new Map<string, () => void>()
  const document = { visibilityState: 'hidden', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
  vi.stubGlobal('document', document)
  const { starts, send, stops } = await setup([['chat', 7, 'messages', 3, {}], ['inbox', 'messages', 3]])
  send('liwan/chat', { id: 3, event: 'message_created' }); send('liwan/inbox', { id: 3, event: 'conversation' })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(starts.map(fn => fn.mock.calls.length)).toEqual([0, 0])
  document.visibilityState = 'visible'; listeners.get('visibilitychange')!()
  await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1]))
  stops.forEach(stop => stop())
})
it.each(['initial', 'refetch'] as const)('retains a hidden event across a pending %s snapshot until one visible catchup', async phase => {
  const listeners = new Map<string, () => void>()
  const document = { visibilityState: 'visible', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
  vi.stubGlobal('document', document)
  let release!: (value: object) => void
  const snapshot = new Promise<object>(resolve => { release = resolve })
  const key = ['inbox', 'messages', 3]
  const { qc, starts, send, stops } = await setup([key, ['inbox', 'messages', 4]], phase === 'initial' ? () => snapshot : undefined)
  starts[0]!.mockResolvedValue({ version: 'post-event' })
  const before = phase === 'initial' ? 0 : 1
  try {
    if (phase === 'refetch') {
      starts[0]!.mockImplementationOnce(() => snapshot)
      void qc.refetchQueries({ queryKey: key, exact: true })
      await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(1))
    }
    document.visibilityState = 'hidden'
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve()
    release({ version: 'pre-event' })
    await vi.waitFor(() => expect(qc.getQueryState(key)?.fetchStatus).toBe('idle'))
    expect(qc.getQueryData(key)).toEqual({ version: 'pre-event' })
    expect(starts.map(fn => fn.mock.calls.length)).toEqual([before, 0])
    document.visibilityState = 'visible'; listeners.get('visibilitychange')!()
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual({ version: 'post-event' }))
    expect(starts.map(fn => fn.mock.calls.length)).toEqual([before + 1, 0])
  } finally { stops.forEach(stop => stop()) }
})
it('retains a hidden event while a visible event catchup is still fetching', async () => {
  const listeners = new Map<string, () => void>()
  const document = { visibilityState: 'visible', addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) }
  vi.stubGlobal('document', document)
  const key = ['inbox', 'messages', 3]
  const { qc, starts, send, stops } = await setup([key, ['inbox', 'messages', 4]])
  let releaseRead!: (value: object) => void
  let releaseCatchup!: (value: object) => void
  starts[0]!.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve }))
  starts[0]!.mockImplementationOnce(() => new Promise(resolve => { releaseCatchup = resolve }))
  starts[0]!.mockResolvedValue({ version: 'latest' })
  try {
    void qc.refetchQueries({ queryKey: key, exact: true })
    await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(1))
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve()
    releaseRead({ version: 'old' })
    await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(2))
    document.visibilityState = 'hidden'
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve()
    releaseCatchup({ version: 'before-hidden-event' })
    await vi.waitFor(() => expect(qc.getQueryState(key)?.fetchStatus).toBe('idle'))
    expect(qc.getQueryData(key)).toEqual({ version: 'before-hidden-event' })
    expect(starts.map(fn => fn.mock.calls.length)).toEqual([2, 0])
    document.visibilityState = 'visible'; listeners.get('visibilitychange')!()
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual({ version: 'latest' }))
    expect(starts.map(fn => fn.mock.calls.length)).toEqual([3, 0])
  } finally { stops.forEach(stop => stop()) }
})
it('coalesces a burst during a slow read and reconciles once after that snapshot', async () => {
  const { starts, send, stops } = await setup([['inbox', 'messages', 3]])
  let release!: (value: object) => void
  starts[0]!.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  send('liwan/inbox', { id: 3, event: 'conversation' })
  await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(1))
  for (let i = 0; i < 100; i++) send('liwan/inbox', { id: 3, event: 'conversation' })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(starts[0]).toHaveBeenCalledTimes(1)
  release({})
  await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(2))
  stops.forEach(stop => stop())
})
it('task events refresh project aggregates without unrelated followers, settings or updates', async () => {
  const { starts, send, stops } = await setup([['tasks', 'detail', 1], ['projects', 'detail', 5], ['projects', 'detail', 5, 'stages'], ['projects', 'detail', 5, 'followers'], ['projects', 'detail', 5, 'updates'], ['projects', 'settings'], ['projects', 'summary', {}], ['projects', 'detail', 8]])
  clients.at(-1)!.setQueryData(['tasks', 'detail', 1], { id: 1, project: { id: 5 } })
  send('liwan/task', { id: 1, event: 'updated' })
  await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1, 1, 0, 0, 0, 1, 0]))
  stops.forEach(stop => stop())
})

it.each([true, false])('task events refresh live EVM and variance without baseline snapshots (known project=%s)', async known => {
  const keys = [
    ['projects', 'detail', 5, 'evm'], ['projects', 'detail', 5, 'baselines', 'variance'],
    ['projects', 'detail', 5, 'baselines', 'list', {}], ['projects', 'detail', 5, 'baselines', 'item', 1],
    ['projects', 'detail', 5, 'followers'], ['projects', 'detail', 5, 'updates'], ['projects', 'settings'],
    ['projects', 'detail', 8, 'evm'], ['projects', 'detail', 8, 'baselines', 'variance'],
  ]
  const { qc, starts, send, stops } = await setup(keys)
  if (known) qc.setQueryData(['tasks', 'detail', 1], { id: 1, project: { id: 5 } })
  try {
    send('liwan/task', { id: 1, event: 'updated' })
    await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0, 0, known ? 0 : 1, known ? 0 : 1]))
  } finally { stops.forEach(stop => stop()) }
})
