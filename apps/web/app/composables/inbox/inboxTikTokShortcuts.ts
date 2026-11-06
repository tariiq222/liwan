import { INBOX_TIKTOK_LIMITS, InboxTikTokShortcutCreateSchema, type InboxTikTokShortcut, type InboxTikTokShortcutCreate, type InboxTikTokShortcutKind } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

// The suggested questions (3 at most) and chat prompts (6 at most) LiwanOS mirrors to TikTok, with the count and length
// limits of INBOX_TIKTOK_LIMITS. An item TikTok is still reviewing cannot be edited: the server refuses it and the
// form stays closed here.
export const SHORTCUT_AUDIT_TONE: Record<InboxTikTokShortcut['audit'], StatusTone> = {
  draft: 'neutral', reviewing: 'warning', approved: 'success', rejected: 'destructive',
}

export interface ShortcutDraft {
  kind: InboxTikTokShortcutKind
  sequence: number | null
  question: string
  answer: string
  title: string
  content: string
}

export const emptyShortcutDraft = (kind: InboxTikTokShortcutKind): ShortcutDraft => ({
  kind, sequence: null, question: '', answer: '', title: '', content: '',
})

/** The items of one kind this account may still hold. */
export function shortcutLimit(kind: InboxTikTokShortcutKind): number {
  return kind === 'question' ? INBOX_TIKTOK_LIMITS.questions : INBOX_TIKTOK_LIMITS.prompts
}

export function shortcutLimitReached(kind: InboxTikTokShortcutKind, items: readonly InboxTikTokShortcut[]): boolean {
  return items.filter(item => item.kind === kind).length >= shortcutLimit(kind)
}

/** TikTok's review locks an item: no edit until it settles, the create form and the delete stay available. */
export function shortcutEditBlocked(shortcut: Pick<InboxTikTokShortcut, 'audit'>): boolean {
  return shortcut.audit === 'reviewing'
}

export function shortcutToDraft(shortcut: InboxTikTokShortcut): ShortcutDraft {
  return {
    kind: shortcut.kind,
    sequence: shortcut.sequence,
    question: shortcut.question ?? '',
    answer: shortcut.answer ?? '',
    title: shortcut.title ?? '',
    content: shortcut.content ?? '',
  }
}

/** The create (or patch) body of a draft, or null while a field is empty or past its limit. */
export function buildShortcut(draft: ShortcutDraft): InboxTikTokShortcutCreate | null {
  const candidate = draft.kind === 'question'
    ? { kind: 'question', question: draft.question.trim(), answer: draft.answer.trim() }
    : { kind: 'prompt', title: draft.title.trim(), content: draft.content.trim() }
  const withSequence = draft.sequence === null ? candidate : { ...candidate, sequence: draft.sequence }
  const parsed = InboxTikTokShortcutCreateSchema.safeParse(withSequence)
  return parsed.success ? parsed.data : null
}

/** The sequence of a new item: after the highest stored one, so TikTok keeps showing them in their order. */
export function nextShortcutSequence(items: readonly InboxTikTokShortcut[]): number {
  return items.reduce((next, item) => Math.max(next, item.sequence + 1), 0)
}
