import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { isWhatsAppChannel } from '../../../composables/inbox/inboxChannelKind'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxWorkspace.vue', import.meta.url)

// Orders and the catalog are WhatsApp only: the server refuses them on a TikTok conversation (422
// `inbox_channel_kind_unsupported`), so the commerce query is not asked for and the orders toggle and panel stay out.
function mount(kind: 'whatsapp' | 'tiktok', ordersOpen = true) {
  const commerceEnabled = vi.fn()
  const { state } = mountScript(filename, {
    useRoute: () => ({ query: {}, path: '/inbox/5' }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useEscapeBack: vi.fn(),
    useInboxCatalogEnabled: () => Vue.ref(true),
    useInboxWhatsAppEnabled: () => Vue.ref(true),
    useInboxChannelCommerce: (_id: unknown, enabled: () => boolean) => { commerceEnabled.mockImplementation(enabled); return { data: Vue.ref(null) } },
    useInboxConversation: () => ({ data: Vue.ref({ id: 5, can_reply: true, unread: false, contact: {}, channel: { id: 1, kind } }), error: Vue.ref(null), refetch: vi.fn() }),
    useInboxConversations: () => ({ data: Vue.ref({ items: [], total: 1 }) }),
    useMarkInboxConversationRead: () => ({ mutate: vi.fn() }),
    parseInboxListRoute: () => ({ assignee: 'all' }),
    serializeInboxListRoute: () => ({}),
    inboxContactName: () => 'x',
    isWhatsAppChannel,
    EmptyState: null, avatarProps: () => ({}), InboxAvailabilitySwitch: null, InboxComposer: null, InboxConversationActions: null, InboxContactPanel: null, InboxOrderPanel: null,
    InboxConversationList: null, InboxThread: null, ApiError: class {}, CHANNEL_KIND_ICON: {}, CONVERSATION_STATE_TONE: {}, CSAT_TONE: {}, INBOX_PRIORITY_TONE: {}, replyWindowOpen: () => true,
  }, { conversationId: 5, ordersOpen })
  return { state, commerceEnabled }
}

describe('InboxWorkspace orders', () => {
  it('offers the orders toggle and panel and asks for the commerce answer on a WhatsApp conversation', () => {
    const { state, commerceEnabled } = mount('whatsapp')
    expect(state.ordersAvailable).toBe(true)
    expect(state.ordersOpen).toBe(true)
    expect(commerceEnabled()).toBe(true)
  })

  it('offers none of them on a TikTok conversation', () => {
    const { state, commerceEnabled } = mount('tiktok')
    expect(state.ordersAvailable).toBe(false)
    expect(state.ordersOpen).toBe(false)
    expect(commerceEnabled()).toBe(false)
  })

  it('gates the orders toggle on that same answer', () => {
    const source = readFileSync(filename, 'utf8')
    expect(source).toContain('<UTooltip v-if="ordersAvailable"')
    expect(source).not.toContain('v-if="catalogOn"')
  })
})
