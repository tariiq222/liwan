import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
vi.mock('@/components/chat/ChatAttachment.vue', () => ({ default: { render: () => null } }))
vi.mock('@/composables/useApi', () => import('../../../composables/useApi'))
vi.mock('@/composables/useBus', async () => ({ chatDeletedBatch: (await import('vue')).ref([]) }))
vi.mock('@/utils/chatState', () => import('../../../utils/chatState'))
import { chatDeletedBatch } from '@/composables/useBus'
import MessageHistory from '../MessageHistory.vue'

const apps: Array<() => void> = []
afterEach(() => { apps.splice(0).forEach(stop => stop()); vi.unstubAllGlobals() })
type HistorySetup = {
  items: Array<{ id: number }>
  acknowledgeRead: (id: number) => Promise<void>
  onScroll: () => void
  jumpCount: number
  stickToEnd: boolean
  scroller: null | {
    scrollHeight: number; clientHeight: number; scrollTop: number
    getBoundingClientRect: () => { top: number; bottom: number }
    querySelectorAll: () => Array<{ dataset: { messageId: string }; getBoundingClientRect: () => { top: number; bottom: number } }>
  }
}
// Vue hides compiled script-setup bindings from its public instance type. This
// harness inspects only these explicit bindings to drive its deferred lifecycle.
type HistoryInstance = Vue.ComponentInternalInstance & { setupState: HistorySetup }
type Node = { children: Node[]; parent?: Node; props: Record<string, any>; text?: string; scrollTop: number; scrollHeight: number }
function node(): Node { return { children: [], props: {}, scrollTop: 0, scrollHeight: 1000 } }
const renderer = Vue.createRenderer<Node, Node>({
  createElement: node, createText: text => ({ ...node(), text }), createComment: node,
  insert: (child, parent, anchor) => { child.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child) },
  remove: child => { const p = child.parent; if (p) p.children.splice(p.children.indexOf(child), 1) },
  setElementText: (el, text) => { el.text = text; el.children = [] }, setText: (el, text) => { el.text = text },
  parentNode: el => el.parent ?? null, nextSibling: () => null,
  patchProp: (el, key, _old, value) => { el.props[key] = value },
})
const messages = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i, body: `message ${from + i}`, author: { id: 1, name: 'Sender' }, created_at: '2026-11-06T10:00:00Z', attachments: [], reactions: [], pinned: false, deleted: false, reply_to: null }))
async function mount(api: ReturnType<typeof vi.fn>, options: { read?: (conversation: number, message: number) => Promise<unknown>; writable?: boolean; focused?: boolean } = {}) {
  const data = Vue.ref<any>(), updatedAt = Vue.ref(0), conversation = Vue.ref(1), q = Vue.ref(''), me = Vue.ref({ id: 2, company: { id: 1 } })
  for (const name of ['ref', 'computed', 'watch', 'nextTick', 'onMounted', 'onUnmounted', 'onBeforeUnmount'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useI18n', () => ({ t: (s: string) => s, locale: Vue.ref('en') }))
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useHydrated', () => Vue.ref(true)); vi.stubGlobal('useToast', () => ({ add() {} }))
  vi.stubGlobal('useApi', () => ({ $api: api }))
  vi.stubGlobal('useChatMessages', () => ({ data, dataUpdatedAt: updatedAt, error: Vue.ref(null), isFetching: Vue.ref(false), isError: Vue.ref(false), refetch: vi.fn() }))
  for (const name of ['usePatchChatMessage', 'useDeleteChatMessage', 'useReactChatMessage', 'usePinChatMessage', 'useStarChatMessage']) vi.stubGlobal(name, () => ({ mutateAsync: vi.fn() }))
  vi.stubGlobal('useMarkChatRead', (id: () => number) => ({ mutateAsync: (message: number) => options.read?.(id(), message) ?? Promise.resolve() }))
  vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => options.focused ?? false, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  const root = node()
  const app = renderer.createApp({ render: () => Vue.h(MessageHistory, { conversationId: conversation.value, q: q.value, writable: options.writable ?? false }) })
  app.provide(Vue.ssrContextKey!, { modules: new Set() })
  app.config.warnHandler = () => {}
  app.mount(root)
  let mounted = true
  const unmount = () => { if (mounted) { mounted = false; app.unmount() } }
  apps.push(unmount)
  const setup = (app._instance!.subTree.component! as HistoryInstance).setupState
  async function page(items: any[]) { data.value = { items, total: items.length }; updatedAt.value++; await Vue.nextTick(); await Vue.nextTick() }
  const ids = () => setup.items.map((item: any) => item.id)
  return { page, ids, conversation, q, me, unmount, read: (id: number) => setup.acknowledgeRead(id), setup }
}
it('drops every message the other participants deleted for good in one bus frame, and only those of this conversation', async () => {
  const history = await mount(vi.fn())
  await history.page(messages(1, 5))
  chatDeletedBatch.value = [{ conversationId: 1, messageId: 2 }, { conversationId: 2, messageId: 3 }, { conversationId: 1, messageId: 4 }]
  await Vue.nextTick()
  expect(history.ids()).toEqual([1, 3, 5])
})
it('fills a missed-event gap from the last known cursor before merging the latest query page', async () => {
  const api = vi.fn(async (_path, options) => ({ items: options.query.after === 50 ? messages(51, 100) : options.query.after === 100 ? messages(101, 150) : [], total: 150 }))
  const history = await mount(api)
  await history.page(messages(1, 50))
  await history.page(messages(101, 150))
  await vi.waitFor(() => expect(history.ids()).toHaveLength(150))
  expect(api.mock.calls.map(call => call[1].query.after)).toEqual([50, 100, 150])
})
it('does not skip the missing history when catch-up fails and retries on the next successful poll', async () => {
  const api = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (_path, options) => ({ items: options.query.after === 50 ? messages(51, 100) : options.query.after === 100 ? messages(101, 150) : [], total: 150 }))
  const history = await mount(api)
  await history.page(messages(1, 50)); await history.page(messages(101, 150))
  await Vue.nextTick(); await Vue.nextTick()
  expect(history.ids()).toHaveLength(50)
  await history.page(messages(101, 150))
  await vi.waitFor(() => expect(history.ids()).toHaveLength(150))
})
it('aborts catch-up when navigating away and ignores its old response', async () => {
  let resolve!: (result: any) => void
  const api = vi.fn((_path, _options) => new Promise(r => { resolve = r }))
  const history = await mount(api)
  await history.page(messages(1, 50)); await history.page(messages(101, 150))
  expect(api).toHaveBeenCalledTimes(1)
  history.conversation.value = 2; await Vue.nextTick()
  expect(api.mock.calls[0]![1].signal.aborted).toBe(true)
  resolve({ items: messages(51, 100), total: 100 }); await Vue.nextTick(); await Vue.nextTick()
  expect(history.ids()).toHaveLength(0)
})
it.each(['navigation', 'identity', 'unmount'])('disposes queued read positions on %s before an old request resolves', async kind => {
  let release!: () => void
  const write = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  const history = await mount(vi.fn(), { read: write })
  const first = history.read(10); void history.read(12)
  expect(write.mock.calls).toEqual([[1, 10]])
  if (kind === 'navigation') history.conversation.value = 2
  else if (kind === 'identity') history.me.value = { id: 3, company: { id: 2 } }
  else history.unmount()
  await Vue.nextTick()
  release(); await Promise.resolve(); await Promise.resolve()
  expect(write.mock.calls).toEqual([[1, 10]])
  await first
})
it('acknowledges a newly merged visible message without relying on a scroll event', async () => {
  const write = vi.fn(async () => undefined)
  const history = await mount(vi.fn(), { read: write, writable: true, focused: true })
  // A short non-overflowing thread: scrollTop remains clamped at zero.
  history.setup.scroller = {
    scrollHeight: 100, clientHeight: 100, get scrollTop() { return 0 }, set scrollTop(_value: number) {},
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    querySelectorAll: () => history.setup.items.map((item: any) => ({ dataset: { messageId: String(item.id) }, getBoundingClientRect: () => ({ top: 0, bottom: 20 }) })),
  }
  await history.page(messages(10, 10)); await history.read(10); write.mockClear()
  await history.page(messages(10, 12))
  await vi.waitFor(() => expect(write.mock.calls).toEqual([[1, 12]]))
})
it.each(['hidden', 'unfocused'])('does not acknowledge a merged message while %s', async state => {
  const write = vi.fn(async () => undefined)
  const history = await mount(vi.fn(), { read: write, writable: true, focused: state !== 'unfocused' })
  if (state === 'hidden') (document as any).visibilityState = 'hidden'
  history.setup.scroller = { scrollHeight: 100, clientHeight: 100, scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => [{ dataset: { messageId: '12' }, getBoundingClientRect: () => ({ top: 0, bottom: 20 }) }] }
  await history.page(messages(10, 10)); await history.page(messages(10, 12)); await Vue.nextTick()
  expect(write).not.toHaveBeenCalled()
})

it.each([1, 2])('counts %s new messages from an ordinary query page while reading above the bottom', async count => {
  const history = await mount(vi.fn())
  await history.page(messages(1, 50))
  history.setup.scroller = { scrollHeight: 1000, clientHeight: 100, scrollTop: 200, getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => [] }
  history.setup.onScroll()
  await history.page(messages(49, 50 + count))
  expect(history.setup.stickToEnd).toBe(false)
  expect(history.setup.jumpCount).toBe(count)
  // Query polling/reactions may replace the same rows without adding new ids.
  await history.page(messages(49, 50 + count).map(item => ({ ...item, body: 'updated', reactions: [{ content: '👍', count: 1, me: false }] })))
  expect(history.setup.jumpCount).toBe(count)
  // Replayed latest-page ids are still the same new messages, counted once.
  await history.page(messages(50, 50 + count))
  expect(history.setup.jumpCount).toBe(count)
  history.setup.scroller.scrollTop = 1000
  history.setup.onScroll(); await Vue.nextTick()
  expect(history.setup.jumpCount).toBe(0)
})
it('counts a full gap recovery once and adds a later ordinary page without recounting the gap', async () => {
  const api = vi.fn(async (_path, options) => ({ items: options.query.after === 50 ? messages(51, 100) : options.query.after === 100 ? messages(101, 150) : [], total: 150 }))
  const history = await mount(api)
  await history.page(messages(1, 50))
  history.setup.scroller = { scrollHeight: 1000, clientHeight: 100, scrollTop: 200, getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => [] }
  history.setup.onScroll()
  await history.page(messages(101, 150))
  await vi.waitFor(() => expect(history.setup.jumpCount).toBe(100))
  expect(history.setup.jumpCount).toBe(100)
  await history.page(messages(101, 150))
  expect(history.setup.jumpCount).toBe(100)
  await history.page(messages(149, 151))
  expect(history.setup.jumpCount).toBe(101)
  history.conversation.value = 2; await Vue.nextTick()
  expect(history.setup.jumpCount).toBe(0)
})

it('retains history, scroll state and queued read ownership on a same-identity object refresh', async () => {
  let release!: () => void
  const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve })).mockResolvedValue(undefined)
  const history = await mount(vi.fn(), { read: write })
  await history.page(messages(1, 50))
  const scroller = { scrollHeight: 1000, clientHeight: 100, scrollTop: 80, getBoundingClientRect: () => ({ top: 0, bottom: 100 }), querySelectorAll: () => [] }
  history.setup.scroller = scroller
  const ownedScroller = history.setup.scroller
  history.setup.onScroll()
  await history.page(messages(49, 51))
  expect(history.setup.jumpCount).toBe(1)
  const first = history.read(10); void history.read(12)
  history.me.value = { id: 2, company: { id: 1 } }
  await Vue.nextTick(); await Vue.nextTick()
  expect(history.ids()).toEqual(Array.from({ length: 51 }, (_, i) => i + 1))
  expect(history.setup.jumpCount).toBe(1)
  expect(history.setup.stickToEnd).toBe(false)
  expect(history.setup.scroller).toBe(ownedScroller)
  expect(scroller.scrollTop).toBe(80)
  release(); await first
  await vi.waitFor(() => expect(write.mock.calls).toEqual([[1, 10], [1, 12]]))
})
it('keeps an in-flight history catchup alive through a same-identity object refresh', async () => {
  let release!: (result: object) => void
  const api = vi.fn().mockImplementationOnce(() => new Promise<object>(resolve => { release = resolve }))
    .mockImplementation(async (_path, options) => ({ items: options.query.after === 100 ? messages(101, 150) : [], total: 150 }))
  const history = await mount(api)
  await history.page(messages(1, 50)); await history.page(messages(101, 150))
  expect(api).toHaveBeenCalledTimes(1)
  const signal = api.mock.calls[0]![1].signal
  history.me.value = { id: 2, company: { id: 1 } }
  await Vue.nextTick()
  expect(signal.aborted).toBe(false)
  release({ items: messages(51, 100), total: 150 })
  await vi.waitFor(() => expect(history.ids()).toHaveLength(150))
})

it.each(['conversation', 'query', 'user', 'company'])('still resets history and disposes queued read ownership on a genuine %s boundary', async boundary => {
  let release!: () => void
  const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve })).mockResolvedValue(undefined)
  const history = await mount(vi.fn(), { read: write })
  await history.page(messages(1, 50))
  const first = history.read(10); void history.read(12)
  if (boundary === 'conversation') history.conversation.value = 2
  else if (boundary === 'query') history.q.value = 'search'
  else if (boundary === 'user') history.me.value = { id: 3, company: { id: 1 } }
  else history.me.value = { id: 2, company: { id: 2 } }
  await Vue.nextTick(); await Vue.nextTick()
  expect(history.ids()).toEqual([])
  expect(history.setup.jumpCount).toBe(0)
  expect(history.setup.stickToEnd).toBe(true)
  release(); await first
  await Promise.resolve(); await Promise.resolve()
  expect(write.mock.calls).toEqual([[1, 10]])
})
