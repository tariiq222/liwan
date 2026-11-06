import { expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { writeFileSync } from 'node:fs'
import { mergeMessagePages } from '../../../composables/inbox/useInbox'

const state = vi.hoisted(() => ({ pages: [] as any[] }))
vi.mock('@/composables/inbox/inboxProviderError', () => ({ useInboxProviderError: () => ({ providerText: () => '' }) }))
vi.mock('@/composables/inbox/inboxPresentation', () => ({ DELIVERY_ICON: {}, inboxDayKey: (s: string) => s.slice(0, 10) }))
vi.mock('@/composables/inbox/inboxReactions', () => ({ INBOX_REACTION_EMOJIS: [] }))
vi.mock('@/composables/inbox/useInbox', async () => {
  const Vue = await import('vue')
  const { mergeMessagePages } = await import('../../../composables/inbox/useInbox')
  return { useInboxMessages: () => ({ items: Vue.computed(() => mergeMessagePages(state.pages)), isLoading: Vue.ref(false), isError: Vue.ref(false), error: Vue.ref(null), hasNextPage: Vue.ref(false), isFetchingNextPage: Vue.ref(false), fetchNextPage: vi.fn(), refetch: vi.fn() }), useRetryInboxMessage: () => ({ mutate: vi.fn(), isPending: Vue.ref(false), variables: Vue.ref(null) }), useReactToInboxMessage: () => ({ mutate: vi.fn() }) }
})
import InboxThread from '../InboxThread.vue'

it('retains and renders loaded inbox history at 100, 1000 and 5000 messages without claiming browser timing', async () => {
  for (const name of ['ref', 'computed', 'watch', 'nextTick', 'onScopeDispose'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: Vue.ref('en') }))
  vi.stubGlobal('useHydrated', () => Vue.ref(Boolean(process.env.LIWAN_PERF_PROFILE_CONTROLS))); vi.stubGlobal('useToast', () => ({ add() {} }))
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  const measurements = []
  for (const count of [100, 1000, 5000]) {
    const items = Array.from({ length: count }, (_, index) => ({ id: index + 1, body: `رسالة رقم ${index + 1}`, direction: process.env.LIWAN_PERF_PROFILE_CONTROLS ? ['out', 'in', 'note'][index % 3] : 'in', kind: 'text', author: process.env.LIWAN_PERF_PROFILE_CONTROLS && index % 3 !== 1 ? { id: 1, name: 'Agent' } : null, created_at: '2026-11-06T10:00:00Z', attachments: [], reactions: { customer: null, agent: null }, reply_to: null, delivery_state: process.env.LIWAN_PERF_PROFILE_CONTROLS && index % 3 === 0 ? 'sent' : 'received', error: null, template: null, automated: false, campaign: null }))
    state.pages = []
    for (let offset = count; offset > 0; offset -= 100) state.pages.push({ items: items.slice(Math.max(0, offset - 100), offset), total: count })
    const mergeStart = performance.now(); const merged = mergeMessagePages(state.pages); const mergeMs = performance.now() - mergeStart
    expect(merged).toHaveLength(count)
    const app = Vue.createSSRApp(InboxThread, { conversationId: 1, canReply: Boolean(process.env.LIWAN_PERF_PROFILE_CONTROLS), windowOpen: Boolean(process.env.LIWAN_PERF_PROFILE_CONTROLS) })
    app.component('UButton', Vue.defineComponent({ props: { label: String, disabled: Boolean }, setup: props => () => Vue.h('button', { disabled: props.disabled }, props.label) }))
    app.component('UPopover', Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }))
    app.component('InboxMessageContent', Vue.defineComponent({ props: { message: { type: Object as Vue.PropType<{ body: string }>, required: true } }, setup: props => () => Vue.h('p', props.message.body) }))
    app.config.warnHandler = () => {}
    const renderStart = performance.now(); const html = await renderToString(app); const renderMs = performance.now() - renderStart
    if (process.env.LIWAN_PERF_PROFILE_HTML) writeFileSync(`${process.env.LIWAN_PERF_PROFILE_HTML}-${count}.html`, html)
    const renderedMessages = [...html.matchAll(/data-message-id=/g)].length
    expect(renderedMessages).toBe(count)
    measurements.push({ count, retainedPages: state.pages.length, renderedMessages, htmlBytes: Buffer.byteLength(html), mergeMs, ssrRenderMs: renderMs })
  }
  if (process.env.LIWAN_PERF_PROFILE_OUTPUT) writeFileSync(process.env.LIWAN_PERF_PROFILE_OUTPUT, JSON.stringify({ environment: 'Node24 Vue SSR, actual InboxThread with plain-text content stub; no browser layout, hydration, network or representative media cost measured', measurements }, null, 2))
  vi.unstubAllGlobals()
})
