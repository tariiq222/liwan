import { InboxInteractiveSchema, type InboxChannelKind, type InboxInteractive } from '@liwan/contracts'

// The interactive message an agent builds in the composer: reply buttons, a list, a call-to-action URL, or a form.
// The limits are Meta's, mirrored by InboxInteractiveSchema; the builder shows them as live counters. TikTok carries
// one kind only, its button card: a title of up to 40 characters and one to three buttons of up to 20 (D3).

export type InteractiveType = InboxInteractive['type']
export const INTERACTIVE_TYPES: readonly InteractiveType[] = ['buttons', 'list', 'cta_url', 'flow']

export interface InteractiveLimitValues {
  body: number
  header: number
  footer: number
  buttons: number
  buttonTitle: number
  listButton: number
  displayText: number
  sections: number
  sectionTitle: number
  rows: number
  rowTitle: number
  rowDescription: number
  flowCta: number
}

export const INTERACTIVE_LIMITS: InteractiveLimitValues = {
  body: 1024, header: 60, footer: 60, buttons: 3, buttonTitle: 20, listButton: 20, displayText: 20,
  sections: 10, sectionTitle: 24, rows: 10, rowTitle: 24, rowDescription: 72, flowCta: 30,
}

/** TikTok's button card: the card title is the message body, and it has no header, footer, list or link. */
export const TIKTOK_INTERACTIVE_LIMITS = { body: 40, header: 0, footer: 0, buttons: 3, buttonTitle: 20 }

/** The interactive kinds a channel carries, and the counters of the ones it does. */
export function interactiveTypes(kind: InboxChannelKind): readonly InteractiveType[] {
  return kind === 'tiktok' ? ['buttons'] : INTERACTIVE_TYPES
}

export function interactiveLimits(kind: InboxChannelKind): InteractiveLimitValues {
  return kind === 'tiktok' ? { ...INTERACTIVE_LIMITS, ...TIKTOK_INTERACTIVE_LIMITS } : INTERACTIVE_LIMITS
}

export interface InteractiveRowDraft { title: string; description: string }
export interface InteractiveSectionDraft { title: string; rows: InteractiveRowDraft[] }
export interface InteractiveDraft {
  type: InteractiveType
  body: string
  header: string
  footer: string
  buttons: string[]
  listButton: string
  sections: InteractiveSectionDraft[]
  displayText: string
  url: string
  /** The published form a `flow` message opens, and the button text that opens it. */
  flowId: number | null
  flowCta: string
}

export const emptyInteractiveDraft = (): InteractiveDraft => ({
  type: 'buttons', body: '', header: '', footer: '', buttons: [''], listButton: '', sections: [{ title: '', rows: [{ title: '', description: '' }] }], displayText: '', url: '', flowId: null, flowCta: '',
})

export const interactiveRowCount = (draft: InteractiveDraft) => draft.sections.reduce((total, section) => total + section.rows.length, 0)
const orNull = (value: string) => value.trim() || null

/**
 * The wire message, or null while the draft breaks a limit. Button and row ids are generated from their position, so a
 * customer's choice can be matched back to it. Several sections need a title each (WhatsApp rejects an untitled one).
 */
export function buildInteractive(draft: InteractiveDraft, kind: InboxChannelKind = 'whatsapp'): InboxInteractive | null {
  if (kind === 'tiktok') return buildTikTokCard(draft)
  const common = { body: draft.body.trim(), header: orNull(draft.header), footer: orNull(draft.footer) }
  let candidate: unknown
  if (draft.type === 'buttons') {
    candidate = { type: 'buttons', ...common, buttons: draft.buttons.map((title, index) => ({ id: `btn_${index + 1}`, title: title.trim() })) }
  } else if (draft.type === 'list') {
    if (draft.sections.length > 1 && draft.sections.some(section => !section.title.trim())) return null
    let row = 0
    candidate = {
      type: 'list', ...common, button: draft.listButton.trim(),
      sections: draft.sections.map(section => ({
        title: orNull(section.title),
        rows: section.rows.map(item => ({ id: `row_${++row}`, title: item.title.trim(), description: orNull(item.description) })),
      })),
    }
  } else if (draft.type === 'flow') {
    candidate = { type: 'flow', ...common, flow_id: draft.flowId, cta: draft.flowCta.trim() }
  } else {
    candidate = { type: 'cta_url', ...common, display_text: draft.displayText.trim(), url: draft.url.trim() }
  }
  const parsed = InboxInteractiveSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** TikTok's button card only: any other kind, a header or a footer, or a title over 40 characters is refused. */
function buildTikTokCard(draft: InteractiveDraft): InboxInteractive | null {
  if (draft.type !== 'buttons' || draft.header.trim() || draft.footer.trim()) return null
  const candidate = { type: 'buttons', body: draft.body.trim(), header: null, footer: null, buttons: draft.buttons.map((title, index) => ({ id: `btn_${index + 1}`, title: title.trim() })) }
  const parsed = InboxInteractiveSchema.safeParse(candidate)
  return parsed.success && parsed.data.body.length <= TIKTOK_INTERACTIVE_LIMITS.body ? parsed.data : null
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** A stored draft, defensively read back (storage is untrusted); null when it is not an interactive draft. */
export function normalizeInteractiveDraft(value: unknown): InteractiveDraft | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!INTERACTIVE_TYPES.includes(source.type as InteractiveType)) return null
  const base = emptyInteractiveDraft()
  const sections = Array.isArray(source.sections)
    ? source.sections.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map(section => ({
      title: text(section.title),
      rows: (Array.isArray(section.rows) ? section.rows : []).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map(item => ({ title: text(item.title), description: text(item.description) })),
    }))
    : []
  const draft: InteractiveDraft = {
    ...base, type: source.type as InteractiveType, body: text(source.body), header: text(source.header), footer: text(source.footer),
    buttons: strings(source.buttons).slice(0, INTERACTIVE_LIMITS.buttons), listButton: text(source.listButton), displayText: text(source.displayText), url: text(source.url),
    flowId: typeof source.flowId === 'number' && Number.isSafeInteger(source.flowId) && source.flowId > 0 ? source.flowId : null, flowCta: text(source.flowCta),
  }
  if (!draft.buttons.length) draft.buttons = base.buttons
  if (sections.length && sections.every(section => section.rows.length)) draft.sections = sections
  return draft
}

/** The editable draft of a stored interactive message (an automatic message or a rule reply being edited). */
export function interactiveToDraft(interactive: InboxInteractive): InteractiveDraft {
  const draft: InteractiveDraft = { ...emptyInteractiveDraft(), type: interactive.type, body: interactive.body, header: interactive.header ?? '', footer: interactive.footer ?? '' }
  if (interactive.type === 'buttons') draft.buttons = interactive.buttons.map(button => button.title)
  else if (interactive.type === 'list') {
    draft.listButton = interactive.button
    draft.sections = interactive.sections.map(section => ({
      title: section.title ?? '',
      rows: section.rows.map(row => ({ title: row.title, description: row.description ?? '' })),
    }))
  } else if (interactive.type === 'flow') {
    draft.flowId = interactive.flow_id
    draft.flowCta = interactive.cta
  } else {
    draft.displayText = interactive.display_text
    draft.url = interactive.url
  }
  return draft
}
