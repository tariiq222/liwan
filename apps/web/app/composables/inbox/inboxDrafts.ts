// Unsent text per conversation (reply, internal note, template choice and its parameters), kept in sessionStorage so it
// survives switching conversations and leaving the page, like the chat drafts. The keys carry the user and the
// conversation but no tenant: every tenant is served from its own origin and sessionStorage is per origin.

export interface InboxDraft {
  reply: string
  note: string
  templateId: number | null
  params: string[]
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { reply: '', note: '', templateId: null, params: [] }

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'webvue.inbox.draft.'
const key = (userId: number, conversationId: number) => `${PREFIX}${userId}.${conversationId}`

const isEmpty = (draft: InboxDraft) => !draft.reply && !draft.note && draft.templateId === null && !draft.params.some(Boolean)

function parse(raw: string | null): InboxDraft {
  if (!raw) return { ...EMPTY_INBOX_DRAFT, params: [] }
  try {
    const value = JSON.parse(raw) as Partial<InboxDraft>
    return {
      reply: typeof value.reply === 'string' ? value.reply : '',
      note: typeof value.note === 'string' ? value.note : '',
      templateId: typeof value.templateId === 'number' ? value.templateId : null,
      params: Array.isArray(value.params) ? value.params.filter((item): item is string => typeof item === 'string') : [],
    }
  } catch {
    return { ...EMPTY_INBOX_DRAFT, params: [] }
  }
}

export function createInboxDrafts(storage: () => DraftStorage | undefined) {
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
    get: (userId: number, conversationId: number) => guarded(store => parse(store.getItem(key(userId, conversationId))), { ...EMPTY_INBOX_DRAFT, params: [] }),
    set: (userId: number, conversationId: number, draft: InboxDraft) => guarded((store) => {
      if (isEmpty(draft)) store.removeItem(key(userId, conversationId))
      else store.setItem(key(userId, conversationId), JSON.stringify(draft))
    }, undefined),
    clear: () => guarded((store) => {
      const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((name): name is string => name?.startsWith(PREFIX) ?? false)
      for (const name of keys) store.removeItem(name)
    }, undefined),
  }
}

export const inboxDrafts = createInboxDrafts(() => (import.meta.client ? window.sessionStorage : undefined))
