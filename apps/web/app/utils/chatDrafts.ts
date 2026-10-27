// Unsent message text per conversation, kept in sessionStorage so it survives switching conversations. Text only.

// The keys carry the user and the conversation but no tenant: every tenant is served from its own origin, and
// sessionStorage is per origin. They are removed at logout and when the session expires (clearChatDrafts).
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'webvue.chat.draft.'
const key = (userId: number, conversationId: number) => `${PREFIX}${userId}.${conversationId}`

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
    clear: () => guarded((store) => {
      const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((name): name is string => name?.startsWith(PREFIX) ?? false)
      for (const name of keys) store.removeItem(name)
    }, undefined),
  }
}

export const chatDrafts = createChatDrafts(() => (import.meta.client ? window.sessionStorage : undefined))

export const clearChatDrafts = chatDrafts.clear
