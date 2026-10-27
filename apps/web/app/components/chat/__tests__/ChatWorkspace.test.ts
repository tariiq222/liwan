import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { load } from '../../../pages/documents/__tests__/helpers'
import { ApiError } from '../../../composables/useApi'
import { createChatDrafts } from '../../../utils/chatDrafts'
import { isFatalChatStatus } from '../../../utils/chatState'

function open(store: Map<string, string>, conversationId: number, error: Vue.Ref<unknown> = Vue.ref(null)) {
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  const query = (data: unknown) => ({ data: Vue.ref(data), error, isLoading: Vue.ref(false), refetch: vi.fn() })
  const bindings = {
    onMounted: (fn: () => void) => fn(), useMediaQuery: () => Vue.ref(true), useQueryClient: () => ({ cancelQueries: vi.fn(), removeQueries: vi.fn() }),
    useMe: () => ({ me: Vue.ref({ id: 1 }) }), useEscapeBack: () => {}, useChatConversation: () => query({ name: 'G', type: 'group' }), useChatConversations: () => query({ total: 1, items: [] }),
    chatDrafts: createChatDrafts(() => storage), chatKeys: { root: () => ['chat'] }, applyChatAccessFailure: vi.fn(), chatTypingEvent: Vue.ref(null),
    isFatalChatStatus, parseChatListRoute: () => ({ q: '', filter: 'all', offset: 0 }), serializeChatListRoute: () => ({}), avatarProps: () => ({}),
    EmptyState: {}, ChatInfoPanel: {}, ConversationList: {}, MessageHistory: {}, MessageComposer: {},
  }
  return load('app/components/chat/ChatWorkspace.vue', { conversationId }, true, { bindings })
}

describe('ChatWorkspace', () => {
  it('restores the draft of a conversation after leaving it and coming back, and clears it after a send', async () => {
    const store = new Map<string, string>()
    const first = await open(store, 5)
    first.state.draft.value = 'half-written'
    await Vue.nextTick()
    first.stop()
    const other = await open(store, 6)
    expect(other.state.draft.value).toBe('')
    other.stop()
    const back = await open(store, 5)
    expect(back.state.draft.value).toBe('half-written')
    back.state.draft.value = ''
    await Vue.nextTick()
    expect(store.size).toBe(0)
    back.stop()
  })

  it('marks an unknown conversation as denied with its status so the thread shows a not-found state', async () => {
    const error = Vue.ref<unknown>(null)
    const view = await open(new Map(), 5, error)
    error.value = new ApiError(404, 'not_found', 'gone')
    await Vue.nextTick()
    // The thread slot then renders the not-found state (404) or the forbidden state (403), not a blank page.
    expect(view.state.denied.value).toBe(true)
    expect(view.state.deniedStatus.value).toBe(404)
    expect(view.state.composerOpen.value).toBe(false)
    view.stop()
  })
})
