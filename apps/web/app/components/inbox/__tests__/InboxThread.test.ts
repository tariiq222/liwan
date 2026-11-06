import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { windowClosedErrorKey } from '../../../composables/inbox/inboxWindow'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxThread.vue', import.meta.url)

// The thread's retry toast: a send the server refused because the reply window closed is the one refusal whose
// sentence depends on the channel kind (WhatsApp sends a template after it, TikTok can send nothing at all).
function mount(kind: 'tiktok' | 'whatsapp' | undefined) {
  const toast = vi.fn()
  let onError: ((e: unknown) => void) | undefined
  const refused = Object.assign(new Error('refused'), { status: 422, details: { reason: 'inbox_window_closed' } })
  const { state } = mountScript(filename, {
    useMediaQuery: () => Vue.ref(false),
    DELIVERY_ICON: {},
    INBOX_REACTION_EMOJIS: [],
    inboxDayKey: (date: string) => date.slice(0, 10),
    useInboxProviderError: () => ({ providerText: () => '' }),
    useInboxMessages: () => ({
      items: Vue.ref([]), isLoading: Vue.ref(false), isError: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn(),
      hasNextPage: Vue.ref(false), isFetchingNextPage: Vue.ref(false), fetchNextPage: vi.fn(),
    }),
    useRetryInboxMessage: () => ({
      mutate: (_id: number, options: { onError: (e: unknown) => void }) => { onError = options.onError },
      isPending: Vue.ref(false), variables: Vue.ref(null),
    }),
    useReactToInboxMessage: () => ({ mutate: vi.fn() }),
    useRoute: () => ({ query: {} }),
    windowClosedErrorKey,
    useToast: () => ({ add: toast }),
  }, { conversationId: 5, channelId: 1, channelKind: kind, canReply: true, windowOpen: true })
  return { state, toast, fail: () => { state.retryMessage(9); onError?.(refused) } }
}

describe('InboxThread', () => {
  it('shows the closed-window line of the channel kind when a retry is refused for the window', () => {
    const tiktok = mount('tiktok')
    tiktok.fail()
    expect(tiktok.toast).toHaveBeenLastCalledWith({ title: 'inbox.inbox_window_closed.tiktok', color: 'error' })
    const whatsapp = mount('whatsapp')
    whatsapp.fail()
    expect(whatsapp.toast).toHaveBeenLastCalledWith({ title: 'inbox.inbox_window_closed.whatsapp', color: 'error' })
  })

  it('keeps the server message while the conversation kind is not loaded yet', () => {
    const { toast, fail } = mount(undefined)
    fail()
    expect(toast).toHaveBeenLastCalledWith({ title: 'refused', color: 'error' })
  })
})
