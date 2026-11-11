import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/vue-query'
import { setBusQueryClient, useBus, chatTypists } from '../useBus'
import { scheduleKeys } from '../useProjectSchedule'
import { governanceKeys } from '../projectGovernanceKeys'
import { baselineKeys } from '../projectBaselineKeys'
import { changeKeys } from '../projectChangeKeys'
import { projectKeys } from '../projectKeys'
import { projectsAtRiskAttention } from '../../modules/pmo/attention'
import { inboxKeys } from '../inbox/useInbox'
import { inboxOrderKeys } from '../inbox/useInboxOrders'
import { inboxFlowKeys } from '../inbox/useInboxFlows'
import { inboxCampaignKeys } from '../inbox/useInboxCampaigns'
import { inboxReportKeys } from '../inbox/useInboxReports'
import { inboxCatalogKeys } from '../inbox/useInboxCatalog'
import { inboxSettingsKeys } from '../inbox/useInboxSettings'
import { inboxAutomationKeys } from '../inbox/useInboxAutomation'
import { inboxHealthKeys } from '../inbox/useInboxChannelHealth'
import { inboxTikTokKeys } from '../inbox/inboxTikTok'
import { DEFAULT_INBOX_LIST_ROUTE } from '../inbox/inboxListRoute'
import { DEFAULT_CAMPAIGN_LIST_ROUTE, DEFAULT_RECIPIENT_ROUTE, DEFAULT_AUDIENCE_LIST_ROUTE, DEFAULT_MEMBER_ROUTE } from '../inbox/inboxCampaignRoute'
import { InboxOrderSchema, type InboxOrderPaymentStatus } from '@liwan/contracts'
vi.mock('@/modules/registry', () => ({ hasFeature: () => true }))

let socket: { onopen?: () => void; onmessage?: (e: { data: string }) => void }
const clients: QueryClient[] = []
afterEach(() => { useBus().disconnect(); clients.forEach(c => c.clear()); vi.unstubAllGlobals() })
async function setup(keys: readonly (readonly unknown[])[], firstRead?: () => Promise<object>) {
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
  expect(chatTypists.value).toHaveLength(1)
  await Promise.resolve()
  expect(starts.map(fn => fn.mock.calls.length)).toEqual([0, 0, 0])
  send('liwan/chat', { id: 3, event: 'typing', user_id: 8, is_typing: false })
  expect(chatTypists.value).toEqual([])
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
  send('liwan/task', { id: 1, event: 'updated', source: 'write', changed_fields: ['priority'] })
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
    send('liwan/task', { id: 1, event: 'updated', source: 'write', changed_fields: ['priority'] })
    await vi.waitFor(() => expect(starts.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0, 0, 0, 0, 0, known ? 0 : 1, known ? 0 : 1]))
  } finally { stops.forEach(stop => stop()) }
})

it.each([true, false])('task events refresh schedule and live governance tasks only (known project=%s)', async known => {
  const keys = [
    scheduleKeys.detail(5), [...governanceKeys.all(5), 'task-page', { closed: false, offset: 0 }],
    governanceKeys.raci(5), governanceKeys.register(5, {}), governanceKeys.registerItem(5, 1),
    governanceKeys.stakeholders(5, {}), governanceKeys.stakeholder(5, 1), changeKeys.list(5, {}),
    baselineKeys.list(5, {}), baselineKeys.item(5, 1), projectKeys.followers(5), projectKeys.updates(5), projectKeys.minimal,
    scheduleKeys.detail(8), [...governanceKeys.all(8), 'task-page', { closed: false, offset: 0 }],
  ]
  const { qc, starts, send, stops } = await setup(keys)
  if (known) qc.setQueryData(['tasks', 'detail', 1], { id: 1, project: { id: 5 } })
  try {
    send('liwan/task', { id: 1, event: 'updated', source: 'write', changed_fields: ['priority'] })
    await vi.waitFor(() => expect(starts.map(read => read.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, known ? 0 : 1, known ? 0 : 1]))
  } finally { stops.forEach(stop => stop()) }
})

it('a task event refreshes canonical analytics and the project-status attention reader', async () => {
  const keys = [projectKeys.analytics({ q: 'Company', status: 'at_risk' }), projectsAtRiskAttention.queryKey, projectKeys.minimal]
  const { qc, starts, send, stops } = await setup(keys)
  qc.setQueryData(['tasks', 'detail', 1], { id: 1, project: { id: 5 } })
  try {
    send('liwan/task', { id: 1, event: 'updated', source: 'write', changed_fields: ['priority'] })
    await vi.waitFor(() => expect(starts.map(read => read.mock.calls.length)).toEqual([1, 1, 0]))
  } finally { stops.forEach(stop => stop()) }
})

it.each([
  { reason: 'project move', metadata: { source: 'write', changed_fields: ['project_id'] } },
  { reason: 'parent move', metadata: { source: 'write', changed_fields: ['parent_id'] } },
  { reason: 'mixed or unknown origin', metadata: {} },
  { reason: 'missing changed fields', metadata: { source: 'write' } },
])('refreshes old and possible new project task views after a $reason', async ({ metadata }) => {
  const keys = [scheduleKeys.detail(5), scheduleKeys.detail(8),
    [...governanceKeys.all(5), 'task-page', { closed: false, offset: 0 }],
    [...governanceKeys.all(8), 'task-page', { closed: false, offset: 0 }],
    projectKeys.followers(5), projectKeys.followers(8), projectKeys.updates(8), governanceKeys.stakeholders(8, {}), baselineKeys.item(8, 1)]
  const { qc, starts, send, stops } = await setup(keys)
  qc.setQueryData(['tasks', 'detail', 1], { id: 1, project: { id: 5 } })
  try {
    send('liwan/task', { id: 1, event: 'updated', ...metadata })
    await vi.waitFor(() => expect(starts.map(read => read.mock.calls.length)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0]))
  } finally { stops.forEach(stop => stop()) }
})

function inboxOrder(status: InboxOrderPaymentStatus, id = 80, conversationId = 3) {
  return InboxOrderSchema.parse({
    id, conversation_id: conversationId, channel: { id: 5, name: 'WhatsApp' }, contact: { id: 7, name: 'Customer' },
    message_id: null, state: 'ordered', reference: `SO${id}`, lines: [], cart_total: null, cart_currency: null,
    total: 100, currency: 'SAR', price_changed: false,
    payment: { status, amount_total: 100, amount_due: status === 'paid' ? 0 : 100, refund_due: false, needs_attention: false, currency: 'SAR', expires_at: '2026-11-07T00:00:00Z' },
    pay_link_sent_at: '2026-11-06T10:00:00Z', created_by: { id: 1, name: 'Agent' }, created_at: '2026-11-06T10:00:00Z',
  })
}
it.each(['paid', 'cancelled'] as const)('a payment %s event updates order cards, membership and history using the canonical relation', async status => {
  const keys = [inboxOrderKeys.list({ payment_status: 'payable' }), inboxOrderKeys.list({ payment_status: status }),
    inboxOrderKeys.ofConversation(3), inboxOrderKeys.ofConversation(4), inboxOrderKeys.detail(80), inboxOrderKeys.detail(3), inboxOrderKeys.detail(82),
    inboxKeys.messagesOf(3), inboxKeys.messagesOf(4)]
  const { qc, starts, send, stops } = await setup(keys)
  const before = inboxOrder('payable'), current = inboxOrder(status)
  const pending = { items: [before], total: 1 }, empty = { items: [], total: 0 }, changed = { items: [current], total: 1 }
  const old = [pending, empty, pending, { items: [inboxOrder('payable', 81, 4)], total: 1 }, before, inboxOrder('payable', 3, 4), {}, { items: [], total: 0 }, { items: [], total: 0 }]
  const next = [empty, changed, changed, old[3], current, old[5], current, { items: [{ id: 90, body: status }], total: 1 }, old[8]]
  keys.forEach((key, index) => { qc.setQueryData(key, old[index]); starts[index]!.mockResolvedValue(next[index]!) })
  const inactiveKey = inboxOrderKeys.detail(83)
  qc.setQueryData(inactiveKey, inboxOrder('payable', 83))
  try {
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await vi.waitFor(() => {
      expect(qc.getQueryData(keys[0]!)).toEqual(empty)
      expect(qc.getQueryData(keys[1]!)).toEqual(changed)
      expect(qc.getQueryData(keys[2]!)).toEqual(changed)
      expect(qc.getQueryData(keys[4]!)).toEqual(current)
      expect(qc.getQueryData(keys[6]!)).toEqual(current)
    })
    expect(starts.map(read => read.mock.calls.length)).toEqual([1, 1, 1, 0, 1, 0, 1, 1, 0])
    expect(qc.getQueryState(inactiveKey)?.isInvalidated).toBe(true)
    expect(qc.getQueryData(inactiveKey)).toEqual(inboxOrder('payable', 83))
  } finally { stops.forEach(stop => stop()) }
})

type InboxEventCase = { name: string; key: readonly unknown[]; conversation: number; template: number; data?: unknown }
const inboxEventCases: InboxEventCase[] = [
  { name: 'all conversation filters', key: inboxKeys.list({ ...DEFAULT_INBOX_LIST_ROUTE, state: 'closed', offset: 20 }), conversation: 1, template: 0 },
  { name: 'matching conversation', key: inboxKeys.detail(3), conversation: 1, template: 0 },
  { name: 'other conversation', key: inboxKeys.detail(4), conversation: 0, template: 0 },
  { name: 'matching history', key: inboxKeys.messagesOf(3), conversation: 1, template: 0 },
  { name: 'other history', key: inboxKeys.messagesOf(4), conversation: 0, template: 0 },
  { name: 'global empty order filter', key: inboxOrderKeys.list({ payment_status: 'paid', offset: 20 }), conversation: 1, template: 0 },
  { name: 'conversation orders', key: inboxOrderKeys.ofConversation(3), conversation: 1, template: 0 },
  { name: 'other conversation orders', key: inboxOrderKeys.ofConversation(4), conversation: 0, template: 0 },
  { name: 'known order relation', key: inboxOrderKeys.detail(80), data: { conversation_id: 3 }, conversation: 1, template: 0 },
  { name: 'different order relation even with matching numeric id', key: inboxOrderKeys.detail(3), data: { conversation_id: 4 }, conversation: 0, template: 0 },
  { name: 'unknown order relation', key: inboxOrderKeys.detail(82), conversation: 1, template: 0 },
  { name: 'flow list', key: inboxFlowKeys.list(5, { status: 'published' }), conversation: 1, template: 1 },
  { name: 'flow count', key: inboxFlowKeys.flow(20), conversation: 1, template: 1 },
  { name: 'global submission filter', key: inboxFlowKeys.submissions(20, { offset: 20 }), conversation: 1, template: 1 },
  { name: 'conversation submissions', key: inboxFlowKeys.conversation(3), conversation: 1, template: 0 },
  { name: 'other submissions', key: inboxFlowKeys.conversation(4), conversation: 0, template: 0 },
  { name: 'completed campaign list', key: inboxCampaignKeys.list({ ...DEFAULT_CAMPAIGN_LIST_ROUTE, state: 'done' }), conversation: 1, template: 1 },
  { name: 'campaign detail', key: inboxCampaignKeys.detail(10), conversation: 1, template: 1 },
  { name: 'filtered campaign recipients', key: inboxCampaignKeys.recipients(10, { ...DEFAULT_RECIPIENT_ROUTE, state: 'read' }), conversation: 1, template: 1 },
  { name: 'matching preview template', key: inboxCampaignKeys.preview({ template_id: 2, params: [] }), conversation: 0, template: 1 },
  { name: 'other preview template', key: inboxCampaignKeys.preview({ template_id: 9, params: [] }), conversation: 0, template: 0 },
  { name: 'unknown preview template', key: [...inboxCampaignKeys.campaigns, 'preview', {}], conversation: 0, template: 1 },
  { name: 'audience list', key: inboxCampaignKeys.audienceList(DEFAULT_AUDIENCE_LIST_ROUTE), conversation: 1, template: 1 },
  { name: 'audience choices', key: [...inboxCampaignKeys.audiences, 'choices'], conversation: 1, template: 1 },
  { name: 'audience count', key: inboxCampaignKeys.audience(7), conversation: 1, template: 1 },
  { name: 'filtered audience members', key: inboxCampaignKeys.members(7, { ...DEFAULT_MEMBER_ROUTE, consent: 'opted_in' }), conversation: 1, template: 1 },
  { name: 'contact consent', key: inboxCampaignKeys.marketing(7), conversation: 1, template: 1 },
  { name: 'channel metadata', key: inboxSettingsKeys.channels, conversation: 1, template: 1 },
  { name: 'exact channel metadata', key: inboxSettingsKeys.channel(5), conversation: 1, template: 1 },
  { name: 'account sending budget', key: inboxCampaignKeys.sending(5), conversation: 1, template: 1 },
  { name: 'channel alerts', key: inboxHealthKeys.alerts(5, 20), conversation: 1, template: 1 },
  { name: 'TikTok shortcut audit', key: inboxTikTokKeys.shortcuts(5), conversation: 1, template: 0 },
  { name: 'TikTok import status', key: inboxTikTokKeys.sync(5), conversation: 1, template: 0 },
  { name: 'report overview opportunistic preservation', key: inboxReportKeys.overview({}), conversation: 1, template: 1 },
  { name: 'report breakdown opportunistic preservation', key: inboxReportKeys.breakdown('channel', {}), conversation: 1, template: 1 },
  { name: 'cost report preservation', key: inboxReportKeys.costs({}), conversation: 1, template: 1 },
  { name: 'report channel refs preservation', key: ['inbox', 'reports', 'channels', '2026-11-07'], conversation: 1, template: 1 },
  { name: 'template analytics list', key: inboxReportKeys.templates({ channel_id: 5 }), conversation: 1, template: 1 },
  { name: 'matching template analytics detail', key: inboxReportKeys.template(2, {}), conversation: 1, template: 1 },
  { name: 'other template analytics detail', key: inboxReportKeys.template(9, {}), conversation: 1, template: 0 },
  { name: 'filtered templates', key: inboxKeys.templateList(5, { status: 'approved' }), conversation: 0, template: 1 },
  { name: 'another template filter', key: inboxKeys.templateList(5, { category: 'marketing' }), conversation: 0, template: 1 },
  { name: 'changed template definition', key: inboxKeys.template(2), conversation: 0, template: 1 },
  { name: 'other template definition', key: inboxKeys.template(9), conversation: 0, template: 0 },
  { name: 'canned replies', key: inboxKeys.canned, conversation: 0, template: 0 },
  { name: 'tags', key: inboxKeys.tags, conversation: 0, template: 0 },
  { name: 'agents', key: inboxKeys.agents, conversation: 0, template: 0 },
  { name: 'settings', key: inboxSettingsKeys.settings, conversation: 0, template: 0 },
  { name: 'departments', key: inboxSettingsKeys.departments, conversation: 0, template: 0 },
  { name: 'channel refs', key: inboxSettingsKeys.channelRef(5), conversation: 0, template: 0 },
  { name: 'campaign channel refs', key: inboxCampaignKeys.channels, conversation: 0, template: 0 },
  { name: 'campaign settings', key: inboxCampaignKeys.settings, conversation: 0, template: 0 },
  { name: 'automation channel refs', key: inboxAutomationKeys.channels, conversation: 0, template: 0 },
  { name: 'working hours', key: inboxAutomationKeys.hours, conversation: 0, template: 0 },
  { name: 'department hours', key: inboxAutomationKeys.departmentHours(1), conversation: 0, template: 0 },
  { name: 'automation configuration', key: inboxAutomationKeys.automation(5), conversation: 0, template: 0 },
  { name: 'rule list', key: inboxAutomationKeys.rules, conversation: 0, template: 0 },
  { name: 'rule', key: inboxAutomationKeys.rule(8), conversation: 0, template: 0 },
  { name: 'catalog list', key: inboxCatalogKeys.catalogs, conversation: 0, template: 0 },
  { name: 'catalog', key: inboxCatalogKeys.catalog(6), conversation: 0, template: 0 },
  { name: 'catalog items', key: inboxCatalogKeys.items(6, {}), conversation: 0, template: 0 },
  { name: 'catalog item', key: inboxCatalogKeys.item(20), conversation: 0, template: 0 },
  { name: 'catalog products', key: inboxCatalogKeys.products(6, ''), conversation: 0, template: 0 },
  { name: 'channel commerce', key: inboxCatalogKeys.commerce(5), conversation: 0, template: 0 },
  { name: 'catalog picker', key: inboxCatalogKeys.pick({ conversationId: 3 }, ''), conversation: 0, template: 0 },
  { name: 'external live Meta profile', key: inboxHealthKeys.profile(5), conversation: 0, template: 0 },
  { name: 'external bell', key: ['notifications'], conversation: 0, template: 0 },
  { name: 'unknown future dynamic resource', key: ['inbox', 'future-dynamic', 1], conversation: 1, template: 1 },
]
it.each(['conversation', 'template'] as const)('preserves the complete %s event dependency matrix with native observers', async event => {
  const keys = inboxEventCases.map(row => row.key)
  const { qc, starts, send, stops } = await setup(keys)
  inboxEventCases.forEach((row, index) => {
    if (row.data !== undefined) qc.setQueryData(row.key, row.data)
    starts[index]!.mockResolvedValue({ fresh: row.name })
  })
  try {
    send('liwan/inbox', { id: event === 'conversation' ? 3 : 2, event })
    await vi.waitFor(() => {
      for (const [index, row] of inboxEventCases.entries()) {
        expect(starts[index]!.mock.calls.length, row.name).toBe(row[event])
        if (row[event]) expect(qc.getQueryData(row.key), row.name).toEqual({ fresh: row.name })
      }
    })
  } finally { stops.forEach(stop => stop()) }
})

it('coalesces order-event bursts during an old read into one trailing payment reconciliation', async () => {
  const key = inboxOrderKeys.detail(80)
  const { qc, starts, send, stops } = await setup([key, inboxKeys.messagesOf(4), inboxCatalogKeys.catalogs])
  qc.setQueryData(key, inboxOrder('payable'))
  let release!: (value: object) => void
  starts[0]!.mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(inboxOrder('paid'))
  try {
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(1))
    for (let index = 0; index < 100; index++) send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve(); await Promise.resolve()
    expect(starts.map(read => read.mock.calls.length)).toEqual([1, 0, 0])
    release(inboxOrder('payable'))
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual(inboxOrder('paid')))
    expect(starts.map(read => read.mock.calls.length)).toEqual([2, 0, 0])
  } finally { stops.forEach(stop => stop()) }
})
function inboxVisibility() {
  const listeners = new Map<string, () => void>()
  const document = { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) }
  vi.stubGlobal('document', document)
  return { document, show: () => { document.visibilityState = 'visible'; listeners.get('visibilitychange')!() } }
}
it.each(['initial', 'refetch'] as const)('retains a hidden payment event after a pending order %s snapshot settles', async phase => {
  const visibility = inboxVisibility(), key = inboxOrderKeys.detail(80)
  let release!: (value: object) => void
  const oldRead = new Promise<object>(resolve => { release = resolve })
  const { qc, starts, send, stops } = await setup([key, inboxKeys.messagesOf(4), inboxCatalogKeys.catalogs], phase === 'initial' ? () => oldRead : undefined)
  starts[0]!.mockResolvedValue(inboxOrder('paid'))
  try {
    if (phase === 'refetch') {
      qc.setQueryData(key, inboxOrder('payable'))
      starts[0]!.mockImplementationOnce(() => oldRead)
      void qc.refetchQueries({ queryKey: key, exact: true })
      await vi.waitFor(() => expect(starts[0]).toHaveBeenCalledTimes(1))
    }
    visibility.document.visibilityState = 'hidden'
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve(); await Promise.resolve()
    release(inboxOrder('payable'))
    await vi.waitFor(() => expect(qc.getQueryState(key)?.fetchStatus).toBe('idle'))
    expect(starts.map(read => read.mock.calls.length)).toEqual([phase === 'initial' ? 0 : 1, 0, 0])
    expect(qc.getQueryData(key)).toEqual(inboxOrder('payable'))
    visibility.show()
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual(inboxOrder('paid')))
    expect(starts.map(read => read.mock.calls.length)).toEqual([phase === 'initial' ? 1 : 2, 0, 0])
  } finally { stops.forEach(stop => stop()) }
})
it('keeps an idle hidden order stale without reads until one visible payment catchup', async () => {
  const visibility = inboxVisibility(), key = inboxOrderKeys.detail(80)
  const { qc, starts, send, stops } = await setup([key, inboxKeys.messagesOf(4), inboxCatalogKeys.catalogs])
  qc.setQueryData(key, inboxOrder('payable')); starts[0]!.mockResolvedValue(inboxOrder('paid'))
  try {
    visibility.document.visibilityState = 'hidden'
    send('liwan/inbox', { id: 3, event: 'conversation' })
    await Promise.resolve(); await Promise.resolve()
    expect(starts.map(read => read.mock.calls.length)).toEqual([0, 0, 0])
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true)
    visibility.show()
    await vi.waitFor(() => expect(qc.getQueryData(key)).toEqual(inboxOrder('paid')))
    expect(starts.map(read => read.mock.calls.length)).toEqual([1, 0, 0])
  } finally { stops.forEach(stop => stop()) }
})
it.each(['queued', 'trailing'] as const)('fences %s payment work from a replacement session client', async phase => {
  const key = inboxOrderKeys.detail(80)
  let release!: (value: object) => void
  const oldRead = new Promise<object>(resolve => { release = resolve })
  const { qc, send, stops } = await setup([key], phase === 'trailing' ? () => oldRead : undefined)
  if (phase === 'queued') qc.setQueryData(key, inboxOrder('payable'))
  send('liwan/inbox', { id: 3, event: 'conversation' })
  if (phase === 'trailing') {
    await Promise.resolve(); await Promise.resolve()
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true)
  }
  useBus().disconnect()
  const current = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  clients.push(current)
  current.setQueryData(key, inboxOrder('paid'))
  const read = vi.fn(async () => inboxOrder('paid'))
  const stop = new QueryObserver(current, { queryKey: key, queryFn: read }).subscribe(() => {})
  setBusQueryClient(current); await useBus().connect(); socket.onopen?.()
  try {
    if (phase === 'trailing') {
      release(inboxOrder('payable'))
      await vi.waitFor(() => expect(qc.getQueryState(key)?.fetchStatus).toBe('idle'))
    }
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
    expect(current.getQueryData(key)).toEqual(inboxOrder('paid'))
  } finally { stop(); stops.forEach(stop => stop()) }
})

it('marks a disabled manual preview stale on a template update without issuing a preview request', async () => {
  const { qc, send } = await setup([])
  const key = [...inboxCampaignKeys.campaigns, 'preview', {}]
  const read = vi.fn(async () => ({ body: 'preview' }))
  const stop = new QueryObserver(qc, { queryKey: key, enabled: false, queryFn: read }).subscribe(() => {})
  try {
    send('liwan/inbox', { id: 2, event: 'template' })
    await vi.waitFor(() => expect(qc.getQueryState(key)?.isInvalidated).toBe(true))
    expect(read).not.toHaveBeenCalled()
    expect(qc.getQueryData(key)).toBeUndefined()
  } finally { stop() }
})
