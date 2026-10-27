import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { load } from '../../../pages/documents/__tests__/helpers'
import { nextListOffset } from '../../../utils/chatState'

const query = (data: unknown, extra: Record<string, unknown> = {}) => ({ data: Vue.ref(data), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn(), ...extra })

async function open(options: { recipients?: unknown; members?: ReturnType<typeof query>; attachments?: ReturnType<typeof query>; q?: string; canRemove?: boolean } = {}) {
  const removeMember = vi.fn().mockResolvedValue({})
  const members = options.members ?? query({ items: [{ id: 7, name: 'Sara', im_status: null }], total: 1 })
  const attachments = options.attachments ?? query({ items: [], total: 0 })
  const recipients = Vue.ref(options.recipients ?? { items: [{ id: 7, name: 'Sara' }, { id: 9, name: 'Mona' }], total: 2 })
  const bindings = {
    useRoute: () => ({ query: {} }), useSsrQuerySeed: () => {}, avatarProps: () => ({}), ChatAttachment: {},
    CHAT_PAGE_SIZE: 50, nextListOffset, parseChatListRoute: () => ({ q: '', filter: 'all', offset: 0 }), serializeChatListRoute: () => ({}),
    useChatConversation: () => query({ id: 3, type: 'group', name: 'G', can_manage: true, can_remove_members: options.canRemove ?? false }),
    useMe: () => ({ me: Vue.ref({ id: 1 }) }), useRemoveChatMember: () => ({ mutateAsync: removeMember }),
    useChatMembers: () => members, useChatAttachments: () => attachments,
    useChatRecipients: (_q: unknown, _o: unknown, active: Vue.MaybeRefOrGetter<boolean>) => ({ data: Vue.computed(() => (Vue.toValue(active) ? recipients.value : undefined)) }),
    usePatchConversation: () => ({ mutateAsync: vi.fn() }), useAddChatMembers: () => ({ mutateAsync: vi.fn() }), useLeaveConversation: () => ({ mutateAsync: vi.fn() }),
  }
  const view = await load('app/components/chat/ChatInfoPanel.vue', { conversationId: 3 }, true, { bindings })
  return { view, members, attachments, removeMember }
}

describe('ChatInfoPanel', () => {
  it('lists no people to add until something is typed', async () => {
    const { view } = await open()
    expect(view.state.candidates.value).toEqual([])
    view.stop()
  })

  it('excludes the people already in the conversation from the add list', async () => {
    const { view } = await open()
    view.state.recipientQ.value = 'a'
    expect(view.state.candidates.value).toEqual([{ id: 9, name: 'Mona' }])
    view.stop()
  })

  it('shows loading and error states instead of the empty text for members and files', async () => {
    const failure = new Error('boom')
    const members = query(undefined, { isLoading: Vue.ref(true) })
    const attachments = query(undefined, { error: Vue.ref(failure) })
    const { view } = await open({ members, attachments })
    const states = (await view.rendered()).filter(node => node.name === 'SharedPageState')
    expect(states[0]?.props.loading).toBe(true)
    expect(states[1]?.props.error).toBe(failure)
    states[1]?.props.onRetry()
    expect(attachments.refetch).toHaveBeenCalled()
    view.stop()
  })

  it('lets only the group creator remove other members, after an inline confirm', async () => {
    const plain = await open()
    expect(plain.view.state.canRemoveMember(7)).toBe(false)
    plain.view.stop()

    const { view, removeMember } = await open({ canRemove: true })
    expect(view.state.canRemoveMember(1)).toBe(false)
    expect(view.state.canRemoveMember(7)).toBe(true)
    view.state.removingId.value = 7
    await view.state.confirmRemove(7)
    expect(removeMember).toHaveBeenCalledWith(7)
    expect(view.state.removingId.value).toBeNull()
    view.stop()
  })

  it('steps back to the last existing member page when a removal empties the current one', async () => {
    const members = query({ items: [{ id: 7, name: 'Sara', im_status: null }], total: 51 })
    const { view } = await open({ members, canRemove: true })
    view.state.memberOffset.value = 50
    members.data.value = { items: [], total: 50 }
    await Vue.nextTick()
    expect(view.state.memberOffset.value).toBe(0)
    view.stop()
  })
})
