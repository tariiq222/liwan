import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'
import { useAiRun } from '../../composables/useAiRun'
import * as aiConversation from '../../composables/useAiConversation'
import * as aiContext from '../../utils/aiContext'
import * as aiSuggestions from '../../utils/aiSuggestions'
import * as aiThread from '../../utils/aiThread'

const appRoot = resolve(import.meta.dirname, '../..')
const mounted: Vue.App[] = []
afterEach(() => { mounted.splice(0).forEach(app => app.unmount()); vi.unstubAllGlobals() })
const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() } }
const textOf = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(textOf).join('')
const responseBody = { run_id: 'identity-a-run', status: 'done', messages: [{ role: 'assistant', content: 'Identity A private transcript' }], pending: null }

function mountActualPage(fetch: typeof globalThis.fetch) {
  const me = Vue.ref<{ id: number; name: string; company: { id: number } } | null>({ id: 7, name: 'A', company: { id: 1 } })
  const states = new Map<string, ReturnType<typeof Vue.ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, Vue.ref(init()))
    return states.get(key)
  })
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('fetch', fetch)
  const route = Vue.reactive({ path: '/ai', query: { run: 'identity-a-run' } as Record<string, string> })
  const router = { replace: vi.fn(async (to: { path: string; query: Record<string, string> }) => { await Vue.nextTick(); route.path = to.path; route.query = to.query }), push: vi.fn() }
  const shown = Vue.ref(true)
  const runs: ReturnType<typeof useAiRun>[] = []
  const box = Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('div', Object.values(slots).flatMap(slot => slot?.() ?? [])) })
  const message = Vue.defineComponent({ props: ['text'], setup: props => () => Vue.h('p', props.text) })
  const modules: Record<string, unknown> = {
    '@vueuse/core': { useMediaQuery: () => Vue.ref(true) },
    '@tanstack/vue-query': { useQueryClient: () => ({ invalidateQueries: vi.fn() }) },
    '@/composables/useAiRun': { useAiRun: () => { const run = useAiRun(); runs.push(run); return run } },
    '@/composables/useAiConversation': aiConversation,
    '@/composables/useAttention': { useAttention: () => ({ rows: Vue.ref([]), pending: Vue.ref(false), failed: Vue.ref(false) }) },
    '@/composables/useAiRuns': { aiRunKeys: { all: ['ai-runs'] }, useAiRuns: () => ({ data: Vue.ref({ items: [] }) }) },
    '@/composables/useAiNowSection': { useAiNowSection: () => ({ hidden: Vue.ref(false), toggle: vi.fn() }) },
    '@/composables/useAssistantSheet': { assistantContext: () => null, useAssistantSheet: () => ({ shown }) },
    '@/composables/useShellModel': { useShellModel: () => ({ activeModule: Vue.ref('home') }) },
    '@/utils/aiContext': aiContext, '@/utils/aiSuggestions': aiSuggestions, '@/utils/aiThread': aiThread,
    '@/utils/aiDraft': { forgetCreatedId: vi.fn(), parseCreatedId: () => null, prepareDraftHandoff: vi.fn(), readCreatedId: () => null, rememberCreatedId: vi.fn() },
  }
  for (const file of ['pages/ai/index.vue', 'components/ai/AiSheet.vue']) {
    for (const match of readFileSync(resolve(appRoot, file), 'utf8').matchAll(/from '(\@\/components\/ai\/[^']+\.vue)'/g)) {
      modules[match[1]!] = { __esModule: true, default: match[1]!.endsWith('/AiMessage.vue') ? message : box }
    }
  }
  const options = { modules, globals: { useRoute: () => route, useRouter: () => router, useMe: () => ({ me }), useRuntimeConfig: () => ({ public: { aiEnabled: true } }) } }
  const page = loadShared(resolve(appRoot, 'pages/ai/index.vue'), options)
  const sheet = loadShared(resolve(appRoot, 'components/ai/AiSheet.vue'), options)
  const root = createHostNode()
  const app = hostRenderer.createApp({ render: () => Vue.h('main', [Vue.h(page), Vue.h(sheet)]) })
  for (const [name, component] of Object.entries({ ...DEFAULT_STUBS, SharedPageContainer: box, SharedListCard: box, SharedEmptyState: box })) app.component(name, component)
  app.mount(root)
  mounted.push(app)
  return { me, route, router, shown, runs, root, shared: states.get('ai-current-run')! }
}

describe('actual full AI page and sheet identity lifecycle', () => {
  it.each(['logout', 'user', 'company', 'clear'])('clears the full page transcript and hidden sheet on %s', async change => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(responseBody)))
    const view = mountActualPage(fetch)
    await settle()
    expect(view.runs[0]!.items.value).toHaveLength(1)
    expect(view.runs[1]!.items.value).toHaveLength(1)
    expect(textOf(view.root)).toContain('Identity A private transcript')
    view.shown.value = false
    if (change === 'clear') view.shared.value = null
    else view.me.value = change === 'logout' ? null : { id: change === 'user' ? 8 : 7, name: 'B', company: { id: change === 'company' ? 2 : 1 } }
    await settle()
    expect(view.shared.value).toBeNull()
    for (const run of view.runs) expect([run.runId.value, run.items.value, run.status.value]).toEqual([null, [], 'idle'])
    expect(textOf(view.root)).not.toContain('Identity A private transcript')
    expect(view.route.query.run).toBeUndefined()
    if (change === 'logout') view.me.value = { id: 8, name: 'B', company: { id: 1 } }
    view.shown.value = true
    await settle()
    expect(textOf(view.root)).not.toContain('Identity A private transcript')
  })

  it('still opens history runs and starts a new conversation through the route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => new Response(JSON.stringify({
      ...responseBody, run_id: String(url).split('/').at(-1),
      messages: [{ role: 'assistant', content: `transcript ${String(url).split('/').at(-1)}` }],
    })))
    const view = mountActualPage(fetch)
    await settle()
    view.route.query = { run: 'history-run' }
    await settle()
    expect(view.runs[0]!.runId.value).toBe('history-run')
    expect(view.shared.value).toBe('history-run')
    expect(view.route.query.run).toBe('history-run')
    expect(textOf(view.root)).toContain('transcript history-run')
    view.route.query = {}
    await settle()
    expect(view.shared.value).toBeNull()
    expect(view.runs[0]!.items.value).toEqual([])
  })

  it('keeps a history destination while its response body is pending', async () => {
    let finish!: (body: unknown) => void
    const body = new Promise(resolve => { finish = resolve })
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => String(url).endsWith('history-run')
      ? { ok: true, json: () => body } as Response
      : new Response(JSON.stringify(responseBody)))
    const view = mountActualPage(fetch)
    await settle()
    view.route.query = { run: 'history-run' }
    await settle()
    expect(view.route.query.run).toBe('history-run')
    finish({ ...responseBody, run_id: 'history-run' })
    await settle()
    expect(view.runs[0]!.runId.value).toBe('history-run')
    expect(view.shared.value).toBe('history-run')
  })

  it('cannot republish an old page id or URL when it changes in the same tick as identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(responseBody)))
    const view = mountActualPage(fetch)
    await settle()
    view.shown.value = false
    view.runs[0]!.runId.value = 'newly-published-a-run'
    view.me.value = { id: 8, name: 'B', company: { id: 1 } }
    await settle()
    expect(view.shared.value).toBeNull()
    expect(view.route.query.run).toBeUndefined()
    expect(view.runs[0]!.items.value).toEqual([])
    expect(textOf(view.root)).not.toContain('Identity A private transcript')
  })

  it('aborts the actual page pending load and rejects its late body after switching identities', async () => {
    let finish!: (body: unknown) => void
    let signal: AbortSignal | undefined
    const body = new Promise(resolve => { finish = resolve })
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      signal = init?.signal ?? undefined
      return { ok: true, json: () => body } as Response
    })
    const view = mountActualPage(fetch)
    await settle()
    view.shown.value = false
    view.me.value = { id: 8, name: 'B', company: { id: 1 } }
    await settle()
    expect(signal?.aborted).toBe(true)
    finish(responseBody)
    await settle()
    expect(view.shared.value).toBeNull()
    expect(view.runs[0]!.items.value).toEqual([])
    expect(view.runs[0]!.runId.value).toBeNull()
    expect(view.route.query.run).toBeUndefined()
    expect(textOf(view.root)).not.toContain('Identity A private transcript')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('actual full AI page and sheet while one of them streams', () => {
  const questionItem = { kind: 'user', text: 'سؤال' }
  const answerItem = { kind: 'assistant', text: 'الجواب', records: [], streaming: false }

  /** A service the test streams by hand: its stored run is final only after `settled` is set. */
  function streamedService() {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(current) { controller = current } })
    const state = { settled: false }
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      // Only the surface that owns the stream sees its events; the other one reads what the server has stored so far.
      return new Response(JSON.stringify({
        run_id: String(url).split('/').at(-1),
        status: state.settled ? 'done' : 'running',
        messages: state.settled ? [{ role: 'user', content: 'سؤال' }, { role: 'assistant', content: 'الجواب' }] : [{ role: 'user', content: 'سؤال' }],
        pending: null,
      }))
    })
    return {
      fetch,
      state,
      push: (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
      end: () => controller.close(),
      loads: (id: string) => fetch.mock.calls.filter(([url, init]) => init?.method !== 'POST' && String(url).endsWith(id)).length,
    }
  }

  it('shows the sheet\'s answer on the full page once that stream settles', async () => {
    const service = streamedService()
    const view = mountActualPage(service.fetch)
    await settle()
    const [pageRun, sheetRun] = [view.runs[0]!, view.runs[1]!]
    // The sheet starts a run and keeps streaming it while the full page opens on it.
    view.route.query = {}
    await settle()
    const sending = sheetRun.send('سؤال')
    service.push('run', { run_id: 'sheet-run' })
    service.push('token', { text: 'الجو' })
    await vi.waitFor(() => expect(view.shared.value).toBe('sheet-run'))
    // The shell closes the sheet when its full page is the surface; the sheet stays mounted and finishes its request.
    view.shown.value = false
    view.route.query = { run: 'sheet-run' }
    await settle()
    expect(pageRun.items.value).toEqual([questionItem])
    expect(pageRun.status.value).toBe('idle')
    expect(service.loads('sheet-run')).toBe(1)
    service.state.settled = true
    service.push('answer', { text: 'الجواب', records: [] })
    service.push('done', { status: 'done' })
    service.end()
    await sending
    await vi.waitFor(() => expect(pageRun.items.value.at(-1)).toMatchObject({ kind: 'assistant', text: 'الجواب' }))
    expect(pageRun.items.value).toEqual([questionItem, answerItem])
    // One snapshot while the stream ran, one reload at its settle: the streaming sheet itself reloaded nothing.
    expect(service.loads('sheet-run')).toBe(2)
  })

  it('refreshes the opened sheet when the full page streams the same run', async () => {
    const service = streamedService()
    const view = mountActualPage(service.fetch)
    await settle()
    const [pageRun, sheetRun] = [view.runs[0]!, view.runs[1]!]
    // The full page starts a run while the sheet is closed; opening it later must not leave it on the snapshot.
    view.route.query = {}
    view.shown.value = false
    await settle()
    const sending = pageRun.send('سؤال')
    service.push('run', { run_id: 'page-run' })
    await vi.waitFor(() => expect(view.shared.value).toBe('page-run'))
    await settle()
    view.shown.value = true
    await settle()
    expect(sheetRun.items.value).toEqual([questionItem])
    expect(sheetRun.status.value).toBe('idle')
    expect(service.loads('page-run')).toBe(1)
    service.state.settled = true
    service.push('answer', { text: 'الجواب', records: [] })
    service.push('done', { status: 'done' })
    service.end()
    await sending
    await vi.waitFor(() => expect(sheetRun.items.value.at(-1)).toMatchObject({ kind: 'assistant', text: 'الجواب' }))
    expect(sheetRun.items.value).toEqual([questionItem, answerItem])
    // The page owns the stream: it reloads nothing, and the sheet reloads exactly once at the settle.
    expect(service.loads('page-run')).toBe(2)
  })
})
