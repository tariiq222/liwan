import {
  InboxTemplateWriteSchema,
  templatePlaceholderCount,
  type InboxTemplate,
  type InboxTemplateCategory,
  type InboxTemplateQuality,
  type InboxTemplateStatus,
  type InboxTemplateWrite,
} from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import type { LocationQuery } from 'vue-router'
import { renderTemplateBody } from './inboxWindow'

// The template builder's pure logic: the draft the form edits, its conversion to and from the wire shape, Meta's
// limits and button rules for live counters, and the WhatsApp-like preview. The limits mirror
// packages/contracts/src/inbox; the zod write schema stays the single validator, this file only explains and guides.

export const TEMPLATE_LIMITS = {
  headerText: 60, body: 1024, footer: 60, buttonText: 25, buttons: 10, urlButtons: 2, phoneButtons: 1, copyCodeButtons: 1, flowButtons: 1,
  url: 2000, example: 1024, couponExample: 15, expirationMinutes: 90,
} as const

/** A page of a channel's templates (`tail` is '', '/new' or '/<id>'); the list filters in `query` (`?status=&category=&q=`) travel with it. */
export function templatesRoute(channelId: number, query: LocationQuery, tail = '') {
  return { path: `/settings/apps/inbox/channels/${channelId}/templates${tail}`, query }
}

export const TEMPLATE_CATEGORIES: readonly InboxTemplateCategory[] = ['marketing', 'utility', 'authentication']
export const TEMPLATE_STATUSES: readonly InboxTemplateStatus[] = ['pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'flagged', 'pending_deletion']
export const TEMPLATE_LANGUAGES: readonly string[] = ['ar', 'en', 'en_US', 'en_GB', 'fr', 'es', 'de', 'tr', 'ur', 'hi', 'id', 'pt_BR']

export const TEMPLATE_STATUS_TONE: Record<InboxTemplateStatus, StatusTone> = {
  pending: 'info', approved: 'success', rejected: 'destructive', paused: 'warning', disabled: 'neutral', in_appeal: 'info', flagged: 'warning', pending_deletion: 'neutral',
}
// Marketing costs more per conversation than utility, so it stands out; authentication is the quietest.
export const TEMPLATE_CATEGORY_TONE: Record<InboxTemplateCategory, StatusTone> = { marketing: 'warning', utility: 'info', authentication: 'neutral' }
export const TEMPLATE_QUALITY_TONE: Record<InboxTemplateQuality, StatusTone> = { green: 'success', yellow: 'warning', red: 'destructive', unknown: 'neutral' }

const RTL_LANGUAGES = new Set(['ar', 'ur', 'he', 'fa'])
/** The text direction of a template language: the preview bubble follows it, not the page. */
export const templateDirection = (language: string): 'rtl' | 'ltr' => RTL_LANGUAGES.has(language.split('_')[0]!) ? 'rtl' : 'ltr'

/** A template name as Meta takes it: lowercase letters, digits and underscores. Typing a space or a symbol gives an underscore. */
export const slugifyTemplateName = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_{2,}/g, '_').slice(0, 512)
/** The final name sent: no underscore at either end. */
export const finalTemplateName = (value: string) => slugifyTemplateName(value).replace(/^_+|_+$/g, '')

export { templatePlaceholderCount }

/** The text with its next variable appended: {{1}} first, then {{2}} and so on. */
export const addTemplateVariable = (text: string) => `${text}{{${templatePlaceholderCount(text) + 1}}}`

/** One example per variable, keeping what was typed for the variables that remain. */
export const resizeExamples = (examples: readonly string[], count: number) => Array.from({ length: count }, (_, index) => examples[index] ?? '')

// ---------------------------------------------------------------- draft

export type ButtonKind = 'quick_reply' | 'url' | 'phone_number' | 'copy_code' | 'flow'
export type HeaderKind = 'none' | 'text' | 'image' | 'video' | 'document' | 'location'
export const HEADER_KINDS: readonly HeaderKind[] = ['none', 'text', 'image', 'video', 'document', 'location']
export type SampleAttachment = { id: number; name: string; mimetype: string; size: number }

export interface ButtonDraft {
  key: number
  type: ButtonKind
  text: string
  url: string
  phone_number: string
  /** The example url of a url with a variable, or the sample coupon code of a copy-code button. */
  example: string
  /** The published form a flow button opens. */
  flowId: number | null
}

export interface TemplateDraft {
  name: string
  language: string
  category: InboxTemplateCategory
  allowCategoryChange: boolean
  headerKind: HeaderKind
  headerText: string
  headerExample: string
  headerSample: SampleAttachment | null
  body: string
  bodyExamples: string[]
  footer: string
  buttons: ButtonDraft[]
  addSecurityRecommendation: boolean
  codeExpirationMinutes: string
  otpButtonText: string
}

let nextButtonKey = 1
export const emptyButton = (type: ButtonKind): ButtonDraft => ({ key: nextButtonKey++, type, text: '', url: '', phone_number: '', example: '', flowId: null })

export const emptyTemplateDraft = (otpButtonText = ''): TemplateDraft => ({
  name: '', language: 'ar', category: 'utility', allowCategoryChange: true,
  headerKind: 'none', headerText: '', headerExample: '', headerSample: null,
  body: '', bodyExamples: [], footer: '', buttons: [],
  addSecurityRecommendation: true, codeExpirationMinutes: '', otpButtonText,
})

const urlHasVariable = (url: string) => url.endsWith('{{1}}')

export function draftFromTemplate(template: InboxTemplate, otpButtonText = ''): TemplateDraft {
  const header = template.header
  return {
    ...emptyTemplateDraft(otpButtonText),
    name: template.name,
    language: template.language,
    category: template.category,
    allowCategoryChange: true,
    headerKind: header?.type ?? 'none',
    headerText: header?.type === 'text' ? header.text : '',
    headerExample: header?.type === 'text' ? header.example ?? '' : '',
    headerSample: header && header.type !== 'text' && header.type !== 'location' ? header.example_attachment : null,
    body: template.category === 'authentication' ? '' : template.body,
    bodyExamples: [...template.body_examples],
    footer: template.category === 'authentication' ? '' : template.footer ?? '',
    buttons: template.category === 'authentication' ? [] : template.buttons.map(button => ({
      ...emptyButton(button.type),
      text: 'text' in button ? button.text : '',
      url: button.type === 'url' ? button.url : '',
      phone_number: button.type === 'phone_number' ? button.phone_number : '',
      example: button.type === 'url' ? button.example ?? '' : button.type === 'copy_code' ? button.example : '',
      flowId: button.type === 'flow' ? button.flow?.id ?? null : null,
    })),
    addSecurityRecommendation: template.add_security_recommendation,
    codeExpirationMinutes: template.code_expiration_minutes ? String(template.code_expiration_minutes) : '',
    otpButtonText: template.otp_button_text ?? otpButtonText,
  }
}

function writeHeader(draft: TemplateDraft) {
  switch (draft.headerKind) {
    case 'none': return null
    case 'location': return { type: 'location' as const }
    case 'text': {
      const text = draft.headerText.trim()
      return { type: 'text' as const, text, example: templatePlaceholderCount(text) === 1 ? draft.headerExample.trim() : null }
    }
    default: return { type: draft.headerKind, example_attachment_id: draft.headerSample?.id ?? 0 }
  }
}

function writeButton(button: ButtonDraft) {
  const text = button.text.trim()
  if (button.type === 'quick_reply') return { type: button.type, text }
  if (button.type === 'phone_number') return { type: button.type, text, phone_number: button.phone_number.trim() }
  if (button.type === 'copy_code') return { type: button.type, example: button.example.trim() }
  if (button.type === 'flow') return { type: button.type, text, flow_id: button.flowId }
  const url = button.url.trim()
  return { type: button.type, text, url, example: urlHasVariable(url) ? button.example.trim() : null }
}

/** The draft as the write contract takes it (not yet validated). */
export function templateWriteCandidate(draft: TemplateDraft): unknown {
  const identity = { name: finalTemplateName(draft.name), language: draft.language, category: draft.category }
  if (draft.category === 'authentication') {
    const minutes = draft.codeExpirationMinutes.trim()
    return {
      ...identity,
      add_security_recommendation: draft.addSecurityRecommendation,
      code_expiration_minutes: minutes ? Number(minutes) : null,
      otp_button_text: draft.otpButtonText.trim(),
    }
  }
  const body = draft.body.trim()
  return {
    ...identity,
    allow_category_change: draft.allowCategoryChange,
    header: writeHeader(draft),
    body,
    body_examples: resizeExamples(draft.bodyExamples, templatePlaceholderCount(body)).map(example => example.trim()),
    footer: draft.footer.trim() || null,
    buttons: draft.buttons.map(writeButton),
  }
}

export type TemplateField = 'name' | 'language' | 'header' | 'body' | 'body_examples' | 'footer' | 'buttons' | 'add_security_recommendation' | 'code_expiration_minutes' | 'otp_button_text' | 'form'
type Issue = { path: PropertyKey[]; code: string; errors?: Issue[][] }

function collectFields(issues: Issue[], category: InboxTemplateCategory, fields: Set<string>, top: boolean) {
  for (const issue of issues) {
    const branch = top && issue.code === 'invalid_union' ? issue.errors?.[category === 'authentication' ? 1 : 0] : undefined
    if (branch) collectFields(branch, category, fields, false)
    else fields.add(String(issue.path[0] ?? 'form'))
  }
}

export type TemplateValidation = { ok: true; data: InboxTemplateWrite } | { ok: false; fields: Set<string> }

/** Validates the draft with the contract's write schema and names the fields that fail. */
export function validateTemplateDraft(draft: TemplateDraft): TemplateValidation {
  const parsed = InboxTemplateWriteSchema.safeParse(templateWriteCandidate(draft))
  if (parsed.success) return { ok: true, data: parsed.data }
  const fields = new Set<string>()
  collectFields(parsed.error.issues as unknown as Issue[], draft.category, fields, true)
  return { ok: false, fields }
}

// ---------------------------------------------------------------- buttons

export type ButtonProblem = 'tooMany' | 'urls' | 'phone' | 'copyCode' | 'flow' | 'grouping'
const count = (buttons: readonly { type: ButtonKind }[], type: ButtonKind) => buttons.filter(button => button.type === type).length

/** Quick replies sit together, before or after the other buttons, never interleaved. */
export function quickRepliesGrouped(buttons: readonly { type: ButtonKind }[]): boolean {
  const runs = buttons.map(button => button.type === 'quick_reply').filter((quick, index, all) => index === 0 || quick !== all[index - 1])
  return runs.length <= 2
}

export function buttonProblems(buttons: readonly { type: ButtonKind }[]): ButtonProblem[] {
  const problems: ButtonProblem[] = []
  if (buttons.length > TEMPLATE_LIMITS.buttons) problems.push('tooMany')
  if (count(buttons, 'url') > TEMPLATE_LIMITS.urlButtons) problems.push('urls')
  if (count(buttons, 'phone_number') > TEMPLATE_LIMITS.phoneButtons) problems.push('phone')
  if (count(buttons, 'copy_code') > TEMPLATE_LIMITS.copyCodeButtons) problems.push('copyCode')
  if (count(buttons, 'flow') > TEMPLATE_LIMITS.flowButtons) problems.push('flow')
  if (!quickRepliesGrouped(buttons)) problems.push('grouping')
  return problems
}

/** Whether one more button of this kind is still within Meta's limits. */
export function canAddButton(buttons: readonly { type: ButtonKind }[], type: ButtonKind): boolean {
  if (buttons.length >= TEMPLATE_LIMITS.buttons) return false
  const limit = { quick_reply: TEMPLATE_LIMITS.buttons, url: TEMPLATE_LIMITS.urlButtons, phone_number: TEMPLATE_LIMITS.phoneButtons, copy_code: TEMPLATE_LIMITS.copyCodeButtons, flow: TEMPLATE_LIMITS.flowButtons }[type]
  return count(buttons, type) < limit
}

/** The buttons with the one at `index` moved by `step` (-1 earlier, 1 later); unchanged at the ends. */
export function moveItem<T>(items: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step
  if (target < 0 || target >= items.length) return [...items]
  const next = [...items]
  next.splice(target, 0, next.splice(index, 1)[0]!)
  return next
}

// ---------------------------------------------------------------- preview

export interface TemplatePreviewParts {
  direction: 'rtl' | 'ltr'
  header: { kind: 'text'; text: string } | { kind: 'media'; media: 'image' | 'video' | 'document'; name: string | null } | { kind: 'location' } | null
  body: string
  footer: string | null
  buttons: { type: ButtonKind; text: string }[]
}

export interface AuthenticationTexts {
  body: string
  security: string
  /** The footer line for an expiry, given the minutes. */
  expiry: (minutes: number) => string
  copyCode: string
}

/** What the builder's live preview shows: the draft with its examples filled in. */
export function draftPreview(draft: TemplateDraft, authentication: AuthenticationTexts): TemplatePreviewParts {
  const direction = templateDirection(draft.language)
  if (draft.category === 'authentication') {
    const minutes = Number(draft.codeExpirationMinutes)
    return {
      direction,
      header: null,
      body: draft.addSecurityRecommendation ? `${authentication.body} ${authentication.security}` : authentication.body,
      footer: minutes >= 1 && minutes <= TEMPLATE_LIMITS.expirationMinutes ? authentication.expiry(minutes) : null,
      buttons: [{ type: 'copy_code', text: draft.otpButtonText.trim() || authentication.copyCode }],
    }
  }
  const header: TemplatePreviewParts['header'] = draft.headerKind === 'none' ? null
    : draft.headerKind === 'location' ? { kind: 'location' }
      : draft.headerKind === 'text' ? { kind: 'text', text: renderTemplateBody(draft.headerText, [draft.headerExample]) }
        : { kind: 'media', media: draft.headerKind, name: draft.headerSample?.name ?? null }
  return {
    direction,
    header,
    body: renderTemplateBody(draft.body, draft.bodyExamples),
    footer: draft.footer.trim() || null,
    buttons: draft.buttons.map(button => ({ type: button.type, text: button.type === 'copy_code' ? authentication.copyCode : button.text })),
  }
}

export interface TemplateSendValues {
  params: readonly string[]
  headerParam: string
  headerMediaName: string | null
}

/** What the composer's preview shows: the stored template with the agent's values filled in. A value not yet typed keeps its placeholder. */
export function templatePreview(template: InboxTemplate, values: TemplateSendValues, copyCodeLabel: string): TemplatePreviewParts {
  const header = template.header
  return {
    direction: templateDirection(template.language),
    header: !header ? null
      : header.type === 'text' ? { kind: 'text', text: renderTemplateBody(header.text, [values.headerParam]) }
        : header.type === 'location' ? { kind: 'location' }
          : { kind: 'media', media: header.type, name: values.headerMediaName },
    body: renderTemplateBody(template.body, values.params),
    footer: template.footer,
    buttons: [
      ...template.buttons.map(button => ({ type: button.type, text: 'text' in button ? button.text : copyCodeLabel })),
      // An authentication template's one OTP button is not among its buttons.
      ...(template.category === 'authentication' ? [{ type: 'copy_code' as const, text: template.otp_button_text ?? copyCodeLabel }] : []),
    ],
  }
}
