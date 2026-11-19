import { expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'

const state = vi.hoisted(() => ({ items: [] as any[] }))
vi.mock('@/composables/inbox/inboxProviderError', () => ({ useInboxProviderError: () => ({ providerText: () => '' }) }))
vi.mock('@/composables/inbox/inboxPresentation', () => ({ DELIVERY_ICON: {}, inboxDayKey: (s: string) => s.slice(0, 10) }))
vi.mock('@/composables/inbox/inboxReactions', () => ({ INBOX_REACTION_EMOJIS: [] }))
vi.mock('@/composables/inbox/inboxWindow', () => import('../../../composables/inbox/inboxWindow'))
vi.mock('@/composables/inbox/useInbox', async () => {
  const Vue = await import('vue')
  return {
    useInboxMessages: () => ({ items: Vue.computed(() => state.items), isLoading: Vue.ref(false), isError: Vue.ref(false), error: Vue.ref(null), hasNextPage: Vue.ref(false), isFetchingNextPage: Vue.ref(false), fetchNextPage: vi.fn(), refetch: vi.fn() }),
    useRetryInboxMessage: () => ({ mutate: vi.fn(), isPending: Vue.ref(false), variables: Vue.ref(null) }),
    useReactToInboxMessage: () => ({ mutate: vi.fn() }),
  }
})
import InboxThread from '../InboxThread.vue'

const message = (id: number, extra: object) => ({
  id, body: '[image]', direction: 'in', kind: 'image', author: null, created_at: '2026-11-06T10:00:00Z', attachments: [], reactions: { customer: null, agent: null },
  reply_to: null, delivery_state: 'received', error: null, error_code: null, media_failed: false, template: null, automated: false, campaign: null, ...extra,
})

it('shows the failed-attachment line with the kind for an inbound media failure and for nothing else', async () => {
  for (const name of ['ref', 'computed', 'watch', 'nextTick', 'onScopeDispose'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useI18n', () => ({ t: (key: string, params?: object) => params ? `${key}|${JSON.stringify(params)}` : key, locale: Vue.ref('ar') }))
  vi.stubGlobal('useHydrated', () => Vue.ref(false))
  vi.stubGlobal('useToast', () => ({ add() {} }))
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  state.items = [message(1, { media_failed: true }), message(2, {})]
  const app = Vue.createSSRApp(InboxThread, { conversationId: 1, canReply: false, windowOpen: false })
  app.component('UButton', Vue.defineComponent({ setup: () => () => Vue.h('button') }))
  app.component('UPopover', Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }))
  app.component('InboxMessageContent', Vue.defineComponent({ props: { message: { type: Object, required: true } }, setup: () => () => Vue.h('p') }))
  app.config.warnHandler = () => {}
  const html = await renderToString(app)
  expect([...html.matchAll(/data-testid="inbox-inbound-error"/g)]).toHaveLength(1)
  expect(html).toContain('inbox.thread.mediaFailed|{&quot;kind&quot;:&quot;inbox.kinds.image&quot;}')
  vi.unstubAllGlobals()
})
