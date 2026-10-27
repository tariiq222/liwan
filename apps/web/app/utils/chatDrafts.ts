// Unsent message text per conversation, kept in sessionStorage so it survives switching conversations. Text only.

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const key = (userId: number, conversationId: number) => `webvue.chat.draft.${userId}.${conversationId}`

export function createChatDrafts(storage: () => DraftStorage | undefined) {
  function guarded<T>(work: (store: DraftStorage) => T, fallback: T): T {
    try {
      const store = storage()
      return store ? work(store) : fallback
    } catch {
      // Storage can be blocked (private window); the draft then lives only in the open form.
      return fallback
    }
  }
  return {
    get: (userId: number, conversationId: number) => guarded(store => store.getItem(key(userId, conversationId)) ?? '', ''),
    set: (userId: number, conversationId: number, text: string) => guarded((store) => {
      if (text) store.setItem(key(userId, conversationId), text)
      else store.removeItem(key(userId, conversationId))
    }, undefined),
  }
}

export const chatDrafts = createChatDrafts(() => (import.meta.client ? window.sessionStorage : undefined))
