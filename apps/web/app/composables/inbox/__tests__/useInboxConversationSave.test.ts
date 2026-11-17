import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutate = vi.fn()
const toast = { add: vi.fn() }
vi.mock('../useInbox', () => ({ usePatchInboxConversation: (id: () => number) => ({ mutate: (...args: unknown[]) => mutate(id(), ...args), isPending: Vue.ref(false) }) }))
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
vi.stubGlobal('useToast', () => toast)

const { useInboxConversationSave } = await import('../useInboxConversationSave')

beforeEach(() => {
  mutate.mockClear()
  toast.add.mockClear()
})

describe('saving a conversation', () => {
  it('sends the revision of the conversation as it is now, for that conversation', () => {
    const conversation = Vue.ref({ id: 7, revision: 4 })
    const { save } = useInboxConversationSave(conversation as never)
    save({ state: 'resolved' })
    expect(mutate).toHaveBeenCalledWith(7, { state: 'resolved', revision: 4 }, expect.any(Object))
    conversation.value = { id: 7, revision: 5 }
    save({ priority: 'high' })
    expect(mutate).toHaveBeenLastCalledWith(7, { priority: 'high', revision: 5 }, expect.any(Object))
  })

  it('shows the refusal message, or the generic one for a value that is not an error', () => {
    const { save } = useInboxConversationSave({ id: 7, revision: 1 } as never)
    save({ state: 'open' })
    const onError = (mutate.mock.calls[0]![2] as { onError: (e: unknown) => void }).onError
    onError(new Error('stale'))
    onError('x')
    expect(toast.add).toHaveBeenNthCalledWith(1, { title: 'stale', color: 'error' })
    expect(toast.add).toHaveBeenNthCalledWith(2, { title: 'errors.generic', color: 'error' })
  })
})
