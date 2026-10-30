import { normalizeInteractiveDraft, type InteractiveDraft } from './inboxInteractive'
import { normalizeLocationDraft, type LocationDraft } from './inboxLocation'

// Unsent text per conversation (reply, internal note, template choice and its parameters (body, header and button), the message being answered,
// a location and an interactive message in progress), kept in sessionStorage so it
// survives switching conversations and leaving the page, like the chat drafts. The keys carry the user and the
// conversation but no tenant: every tenant is served from its own origin and sessionStorage is per origin.

export interface InboxDraft {
  reply: string
  note: string
  templateId: number | null
  params: string[]
  headerParam: string
  buttonParams: string[]
  replyTo: { id: number; preview: string } | null
  location: LocationDraft | null
  interactive: InteractiveDraft | null
}

export const emptyInboxDraft = (): InboxDraft => ({ reply: '', note: '', templateId: null, params: [], headerParam: '', buttonParams: [], replyTo: null, location: null, interactive: null })

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'liwan.inbox.draft.'
const key = (userId: number, conversationId: number) => `${PREFIX}${userId}.${conversationId}`

const isEmpty = (draft: InboxDraft) => !draft.reply && !draft.note && draft.templateId === null && !draft.params.some(Boolean)
  && !draft.headerParam && !draft.buttonParams.some(Boolean)
  && !draft.replyTo && !draft.location && !draft.interactive

function parseReplyTo(value: unknown): InboxDraft['replyTo'] {
  const target = value as { id?: unknown; preview?: unknown } | null
  return target && typeof target.id === 'number' && typeof target.preview === 'string' ? { id: target.id, preview: target.preview } : null
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function parse(raw: string | null): InboxDraft {
  if (!raw) return emptyInboxDraft()
  try {
    const value = JSON.parse(raw) as Partial<InboxDraft>
    return {
      reply: typeof value.reply === 'string' ? value.reply : '',
      note: typeof value.note === 'string' ? value.note : '',
      templateId: typeof value.templateId === 'number' ? value.templateId : null,
      params: strings(value.params),
      headerParam: typeof value.headerParam === 'string' ? value.headerParam : '',
      buttonParams: strings(value.buttonParams),
      replyTo: parseReplyTo(value.replyTo),
      location: normalizeLocationDraft(value.location),
      interactive: normalizeInteractiveDraft(value.interactive),
    }
  } catch {
    return emptyInboxDraft()
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
    get: (userId: number, conversationId: number) => guarded(store => parse(store.getItem(key(userId, conversationId))), emptyInboxDraft()),
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
