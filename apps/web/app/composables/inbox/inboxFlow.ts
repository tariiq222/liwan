import {
  FLOW_INPUT_KINDS,
  InboxFlowWriteSchema,
  type InboxFlow,
  type InboxFlowAnswer,
  type InboxFlowCategory,
  type InboxFlowFieldKind,
  type InboxFlowHealth,
  type InboxFlowInputType,
  type InboxFlowStatus,
  type InboxFlowSummary,
  type InboxFlowWrite,
} from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import type { LocationQuery } from 'vue-router'
import { TEMPLATE_LANGUAGES, templateDirection } from './inboxTemplate'

// The form (WhatsApp Flow) builder's pure logic: the draft the builder edits, its conversion to and from the wire shape,
// Meta's limits for live counters, the mapping of validation problems to the field that caused them, the WhatsApp-like
// preview model and the sector starter forms. The zod write schema in packages/contracts stays the single validator;
// this file only explains and guides.

export const FLOW_CATEGORIES: readonly InboxFlowCategory[] = [
  'lead_generation', 'appointment_booking', 'customer_support', 'contact_us', 'survey', 'sign_up', 'sign_in', 'other',
]
export const FLOW_STATUSES: readonly InboxFlowStatus[] = ['draft', 'published', 'deprecated', 'blocked', 'throttled']
export const FLOW_FIELD_KINDS: readonly InboxFlowFieldKind[] = [
  'heading', 'subheading', 'text', 'caption', 'text_input', 'text_area', 'dropdown', 'radio', 'checkbox', 'date', 'opt_in',
]
export const FLOW_INPUT_TYPES: readonly InboxFlowInputType[] = ['text', 'number', 'email', 'phone']

export const FLOW_STATUS_TONE: Record<InboxFlowStatus, StatusTone> = {
  draft: 'neutral', published: 'success', deprecated: 'neutral', blocked: 'destructive', throttled: 'warning',
}
export const FLOW_HEALTH_TONE: Record<InboxFlowHealth, StatusTone> = { available: 'success', limited: 'warning', blocked: 'destructive', unknown: 'neutral' }
export const FLOW_FIELD_ICON: Record<InboxFlowFieldKind, string> = {
  heading: 'i-lucide-heading-1', subheading: 'i-lucide-heading-2', text: 'i-lucide-text', caption: 'i-lucide-captions',
  text_input: 'i-lucide-text-cursor-input', text_area: 'i-lucide-align-left', dropdown: 'i-lucide-chevrons-up-down', radio: 'i-lucide-circle-dot',
  checkbox: 'i-lucide-square-check', date: 'i-lucide-calendar', opt_in: 'i-lucide-badge-check',
}

export const FLOW_LIMITS = {
  name: 128, completionMessage: 4096, screens: 10, fieldsPerScreen: 49, title: 80, footerLabel: 35, helperText: 80, optionTitle: 30, optionDescription: 300,
  maxChars: 4096, maxLength: 600, optionsInForm: 1000, optInPerScreen: 5, selected: 20, key: 40,
  // The text of a display component and the label of an input, by kind.
  text: { heading: 80, subheading: 80, text: 4096, caption: 409 },
  label: { text_input: 20, text_area: 20, dropdown: 20, radio: 30, checkbox: 30, date: 40, opt_in: 120 },
  options: { dropdown: 200, radio: 20, checkbox: 20 },
} as const

type DisplayKind = keyof typeof FLOW_LIMITS.text
type ChoiceKind = keyof typeof FLOW_LIMITS.options
const DISPLAY_KINDS: readonly InboxFlowFieldKind[] = ['heading', 'subheading', 'text', 'caption']
const CHOICE_KINDS: readonly InboxFlowFieldKind[] = ['dropdown', 'radio', 'checkbox']
const SENSITIVE_KINDS: readonly InboxFlowFieldKind[] = ['text_input', 'text_area', 'dropdown', 'radio', 'checkbox', 'date']

export const isDisplayKind = (kind: InboxFlowFieldKind): kind is DisplayKind => DISPLAY_KINDS.includes(kind)
export const isInputKind = (kind: InboxFlowFieldKind) => (FLOW_INPUT_KINDS as readonly string[]).includes(kind)
export const isChoiceKind = (kind: InboxFlowFieldKind): kind is ChoiceKind => CHOICE_KINDS.includes(kind)
/** Whether a field of this kind may be marked sensitive (an opt-in never is). */
export const canBeSensitive = (kind: InboxFlowFieldKind) => SENSITIVE_KINDS.includes(kind)

/** The languages a form may be written in, each with its name in the interface language (the code when the runtime has none). */
export function flowLanguageItems(locale: string) {
  const names = (() => {
    try { return new Intl.DisplayNames([locale], { type: 'language' }) } catch { return null }
  })()
  return TEMPLATE_LANGUAGES.map((code) => {
    const name = names?.of(code.replace('_', '-'))
    return { value: code, label: name && name !== code ? `${name} (${code})` : code }
  })
}

/** A page of a channel's forms (`tail` is '', '/new' or '/<id>'); the list filters in `query` travel with it. */
export function flowsRoute(channelId: number, query: LocationQuery, tail = '') {
  return { path: `/settings/apps/inbox/channels/${channelId}/flows${tail}`, query }
}

/** The responses page of a form, in the inbox app. */
export const flowResponsesRoute = (flowId: number, query: LocationQuery = {}) => ({ path: `/inbox/flows/${flowId}`, query })

/** The conversation, scrolled to one message when `messageId` is given. */
export function conversationRoute(conversationId: number, messageId?: number, query: LocationQuery = {}) {
  return { path: `/inbox/${conversationId}`, query: { ...query, ...(messageId ? { message: String(messageId) } : {}) } }
}

/** Whether the form may be sent now: published, not blocked. The server decides again at send time. */
export const flowIsSendable = (flow: Pick<InboxFlowSummary, 'sendable'>) => flow.sendable

// ---------------------------------------------------------------- draft

export interface FlowOptionDraft { uid: number; title: string; description: string }

/** One component of a screen. Every kind uses its own subset of these properties (see `writeField`). */
export interface FlowFieldDraft {
  uid: number
  kind: InboxFlowFieldKind
  text: string
  key: string
  label: string
  required: boolean
  sensitive: boolean
  inputType: InboxFlowInputType
  helperText: string
  minChars: string
  maxChars: string
  maxLength: string
  minSelected: string
  maxSelected: string
  minDate: string | null
  maxDate: string | null
  options: FlowOptionDraft[]
}

export interface FlowScreenDraft { uid: number; title: string; footerLabel: string; fields: FlowFieldDraft[] }

export interface FlowDraft {
  name: string
  category: InboxFlowCategory
  language: string
  completionMessage: string
  screens: FlowScreenDraft[]
}

let nextUid = 1
const uid = () => nextUid++

export const emptyOption = (title = '', description = ''): FlowOptionDraft => ({ uid: uid(), title, description })

export const emptyField = (kind: InboxFlowFieldKind): FlowFieldDraft => ({
  uid: uid(), kind, text: '', key: '', label: '', required: isInputKind(kind) && kind !== 'opt_in' ? true : false, sensitive: false, inputType: 'text', helperText: '',
  minChars: '', maxChars: '', maxLength: '', minSelected: '', maxSelected: '', minDate: null, maxDate: null,
  options: isChoiceKind(kind) ? [emptyOption(), emptyOption()] : [],
})

export const emptyScreen = (title = '', footerLabel = ''): FlowScreenDraft => ({ uid: uid(), title, footerLabel, fields: [] })

/** The key of the next answer field: `field_<n>`, the smallest n no field of the form uses (Arabic labels cannot be slugged). */
export function nextFieldKey(draft: Pick<FlowDraft, 'screens'>): string {
  const used = new Set(draft.screens.flatMap(screen => screen.fields.map(field => field.key)))
  let n = 1
  while (used.has(`field_${n}`)) n++
  return `field_${n}`
}

/** The draft with one more field of this kind at the end of a screen; an answer field gets its generated key. */
export function addField(draft: FlowDraft, screenIndex: number, kind: InboxFlowFieldKind): FlowFieldDraft | null {
  const screen = draft.screens[screenIndex]
  if (!screen || screen.fields.length >= FLOW_LIMITS.fieldsPerScreen) return null
  const field = emptyField(kind)
  if (isInputKind(kind)) field.key = nextFieldKey(draft)
  screen.fields.push(field)
  return field
}

export interface FlowDefaults { screenTitle: string; fieldLabel: string; footerNext: string; footerSubmit: string }

/** A new form: one screen with one text question, valid as it stands. */
export function blankFlowDraft(defaults: FlowDefaults, language = 'ar'): FlowDraft {
  const draft: FlowDraft = { name: '', category: 'lead_generation', language, completionMessage: '', screens: [emptyScreen(defaults.screenTitle, defaults.footerSubmit)] }
  const field = addField(draft, 0, 'text_input')!
  field.label = defaults.fieldLabel
  return draft
}

/** A screen's footer button: it submits on the last screen and goes next on the others. */
export const footerLabelFor = (defaults: FlowDefaults, isLast: boolean) => isLast ? defaults.footerSubmit : defaults.footerNext

const text = (value: string | null | undefined) => value ?? ''

export function flowToDraft(flow: InboxFlow): FlowDraft {
  return {
    name: flow.name,
    category: flow.category,
    language: flow.language,
    completionMessage: text(flow.completion_message),
    screens: flow.screens.map(screen => ({
      uid: uid(),
      title: screen.title,
      footerLabel: screen.footer_label,
      fields: screen.fields.map((field): FlowFieldDraft => {
        const draft = emptyField(field.kind)
        draft.options = []
        switch (field.kind) {
          case 'heading': case 'subheading': case 'text': case 'caption':
            return { ...draft, text: field.text }
          case 'text_input':
            return { ...draft, key: field.key, label: field.label, required: field.required, sensitive: field.sensitive, inputType: field.input_type, helperText: text(field.helper_text), minChars: field.min_chars?.toString() ?? '', maxChars: field.max_chars?.toString() ?? '' }
          case 'text_area':
            return { ...draft, key: field.key, label: field.label, required: field.required, sensitive: field.sensitive, helperText: text(field.helper_text), maxLength: field.max_length?.toString() ?? '' }
          case 'dropdown': case 'radio':
            return { ...draft, key: field.key, label: field.label, required: field.required, sensitive: field.sensitive, options: field.options.map(option => emptyOption(option.title, text(option.description))) }
          case 'checkbox':
            return {
              ...draft, key: field.key, label: field.label, required: field.required, sensitive: field.sensitive,
              minSelected: field.min_selected?.toString() ?? '', maxSelected: field.max_selected?.toString() ?? '',
              options: field.options.map(option => emptyOption(option.title, text(option.description))),
            }
          case 'date':
            return { ...draft, key: field.key, label: field.label, required: field.required, sensitive: field.sensitive, helperText: text(field.helper_text), minDate: field.min_date, maxDate: field.max_date }
          case 'opt_in':
            return { ...draft, key: field.key, label: field.label, required: field.required }
        }
      }),
    })),
  }
}

// ---------------------------------------------------------------- wire shape

const orNull = (value: string) => value.trim() || null
/** A blank counter is "not set"; anything else is the number typed (NaN fails the contract and is reported). */
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
const optionWrite = (option: FlowOptionDraft) => ({ title: option.title.trim(), description: orNull(option.description) })

/** One component in the write shape, with exactly the properties its kind takes (the contract objects are strict). */
export function writeField(field: FlowFieldDraft): Record<string, unknown> {
  const answer = { key: field.key.trim(), label: field.label.trim(), required: field.required, sensitive: field.sensitive }
  switch (field.kind) {
    case 'heading': case 'subheading': case 'text': case 'caption':
      return { kind: field.kind, text: field.text.trim() }
    case 'text_input':
      return { kind: field.kind, ...answer, input_type: field.inputType, helper_text: orNull(field.helperText), min_chars: numberOrNull(field.minChars), max_chars: numberOrNull(field.maxChars) }
    case 'text_area':
      return { kind: field.kind, ...answer, helper_text: orNull(field.helperText), max_length: numberOrNull(field.maxLength) }
    case 'dropdown': case 'radio':
      return { kind: field.kind, ...answer, options: field.options.map(optionWrite) }
    case 'checkbox':
      return { kind: field.kind, ...answer, min_selected: numberOrNull(field.minSelected), max_selected: numberOrNull(field.maxSelected), options: field.options.map(optionWrite) }
    case 'date':
      return { kind: field.kind, ...answer, helper_text: orNull(field.helperText), min_date: field.minDate, max_date: field.maxDate }
    case 'opt_in':
      return { kind: field.kind, key: answer.key, label: answer.label, required: field.required }
  }
}

/** The draft as the write contract takes it (not yet validated). */
export function flowWriteCandidate(draft: FlowDraft): unknown {
  return {
    name: draft.name.trim(),
    category: draft.category,
    language: draft.language,
    completion_message: orNull(draft.completionMessage),
    screens: draft.screens.map(screen => ({ title: screen.title.trim(), footer_label: screen.footerLabel.trim(), fields: screen.fields.map(writeField) })),
  }
}

// ---------------------------------------------------------------- problems

/** Where a problem is and what it is: the builder shows `code` under the screen, field or form it points at. */
export interface FlowProblem {
  /** The screen's position, or null for a problem of the form itself. */
  screen: number | null
  /** The field's position inside the screen, or null for a problem of the screen or the form. */
  field: number | null
  /** The property (`label`, `key`, `options`, `title`, ...), or null when the problem spans the field. */
  prop: string | null
  code: FlowProblemCode
}

export type FlowProblemCode =
  | 'invalid' | 'noInput' | 'duplicateKeys' | 'optInCap' | 'optionCap' | 'minChars' | 'selection' | 'dates' | 'duplicateOptions' | 'noFields'

type Issue = { path: PropertyKey[]; message: string }

// The contract's cross-field rules speak English; each one has a stable phrase, mapped here to a locale code.
const SPANNING: ReadonlyArray<[RegExp, FlowProblemCode]> = [
  [/at least one field that collects/, 'noInput'],
  [/key is unique in the form/, 'duplicateKeys'],
  [/at most five opt-in/, 'optInCap'],
  [/at most 1000 choices/, 'optionCap'],
]
const PER_FIELD: ReadonlyArray<[RegExp, FlowProblemCode]> = [
  [/minimum length exceeds/, 'minChars'],
  [/selection limits do not fit/, 'selection'],
  [/earliest date is after/, 'dates'],
  [/choice titles are unique/, 'duplicateOptions'],
]

/** The positions of every field whose key is used twice, so the duplicate is marked where it is typed. */
function duplicateKeyFields(draft: FlowDraft): Array<[number, number]> {
  const seen = new Map<string, Array<[number, number]>>()
  draft.screens.forEach((screen, s) => screen.fields.forEach((field, f) => {
    if (!isInputKind(field.kind)) return
    seen.set(field.key.trim(), [...(seen.get(field.key.trim()) ?? []), [s, f]])
  }))
  return [...seen.values()].filter(group => group.length > 1).flat()
}

/** Positions of the fields of a screen with more than five opt-in boxes: the screen is reported, not a field. */
const fieldPosition = (draft: FlowDraft, key: string): [number, number] | null => {
  for (const [s, screen] of draft.screens.entries()) {
    const f = screen.fields.findIndex(field => isInputKind(field.kind) && field.key.trim() === key)
    if (f >= 0) return [s, f]
  }
  return null
}

function problemOf(draft: FlowDraft, issue: Issue): FlowProblem[] {
  const [root, screen, group, field, prop] = issue.path
  if (root === 'screens' && typeof screen === 'number') {
    if (group === 'fields' && typeof field === 'number') {
      return [{ screen, field, prop: typeof prop === 'string' ? prop : null, code: 'invalid' }]
    }
    if (group === 'fields') return [{ screen, field: null, prop: 'fields', code: 'noFields' }]
    return [{ screen, field: null, prop: typeof group === 'string' ? group : null, code: 'invalid' }]
  }
  if (typeof root === 'string') return [{ screen: null, field: null, prop: root, code: 'invalid' }]
  const spanning = SPANNING.find(([pattern]) => pattern.test(issue.message))
  if (spanning?.[1] === 'duplicateKeys') {
    return duplicateKeyFields(draft).map(([s, f]) => ({ screen: s, field: f, prop: 'key', code: 'duplicateKeys' as const }))
  }
  if (spanning) return [{ screen: null, field: null, prop: null, code: spanning[1] }]
  const perField = PER_FIELD.find(([pattern]) => pattern.test(issue.message))
  const position = perField ? fieldPosition(draft, issue.message.split(':')[0]!) : null
  if (perField && position) return [{ screen: position[0], field: position[1], prop: null, code: perField[1] }]
  return [{ screen: null, field: null, prop: null, code: 'invalid' }]
}

export type FlowValidation = { ok: true; data: InboxFlowWrite } | { ok: false; problems: FlowProblem[] }

/** Validates the draft with the contract's write schema and names where each problem is. */
export function validateFlowDraft(draft: FlowDraft): FlowValidation {
  const parsed = InboxFlowWriteSchema.safeParse(flowWriteCandidate(draft))
  if (parsed.success) return { ok: true, data: parsed.data }
  const problems = parsed.error.issues.flatMap(issue => problemOf(draft, issue as unknown as Issue))
  return { ok: false, problems: problems.length ? problems : [{ screen: null, field: null, prop: null, code: 'invalid' }] }
}

/** The problems that sit on one field. */
export const fieldProblems = (problems: readonly FlowProblem[], screen: number, field: number) =>
  problems.filter(problem => problem.screen === screen && problem.field === field)
/** The problems that sit on one screen itself (its title, footer or empty field list). */
export const screenProblems = (problems: readonly FlowProblem[], screen: number) =>
  problems.filter(problem => problem.screen === screen && problem.field === null)
/** The problems of the form itself (name, language, message, or a rule spanning the whole form). */
export const formProblems = (problems: readonly FlowProblem[]) => problems.filter(problem => problem.screen === null)

/** Where Meta's validation error is in the form, from its JSON path (`$.screens[0].layout.children[2].label`). */
export interface MetaErrorSpot { screen: number; /** The field's position, `footer` for the screen's button, or null for the screen. */ field: number | 'footer' | null }

/**
 * The generated Flow JSON lists a screen's fields in order under `layout.children`, then the footer, so a child index
 * below the field count is that field and the next one is the footer. A path outside a screen stays unplaced (null).
 */
export function locateMetaError(path: string | null, draft: Pick<FlowDraft, 'screens'>): MetaErrorSpot | null {
  if (!path) return null
  const screen = /screens\[(\d+)\]/.exec(path)
  if (!screen) return null
  const position = Number(screen[1])
  const target = draft.screens[position]
  if (!target) return null
  const child = /children\[(\d+)\]/.exec(path)
  if (!child) return { screen: position, field: null }
  const index = Number(child[1])
  if (index < target.fields.length) return { screen: position, field: index }
  return { screen: position, field: index === target.fields.length ? 'footer' : null }
}

/** Meta's errors split by where they show: on a field or screen, and the rest for the form's alert. */
export function placeMetaErrors<E extends { path: string | null }>(errors: readonly E[], draft: Pick<FlowDraft, 'screens'>) {
  const placed: Array<{ error: E; spot: MetaErrorSpot }> = []
  const loose: E[] = []
  for (const error of errors) {
    const spot = locateMetaError(error.path, draft)
    if (spot) placed.push({ error, spot })
    else loose.push(error)
  }
  return { placed, loose }
}

// ---------------------------------------------------------------- reorder

/** The list with the item at `from` moved to `to` (drag and drop); unchanged when either position is outside it. */
export function moveToIndex<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items]
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}

// ---------------------------------------------------------------- preview

export type FlowPreviewComponent =
  | { kind: DisplayKind; text: string }
  | { kind: 'text_input' | 'text_area' | 'date'; label: string; required: boolean; helper: string | null }
  | { kind: 'dropdown' | 'radio' | 'checkbox'; label: string; required: boolean; options: Array<{ title: string; description: string | null }> }
  | { kind: 'opt_in'; label: string; required: boolean }

export interface FlowPreviewScreen { title: string; footer: string; components: FlowPreviewComponent[] }
export interface FlowPreviewModel { direction: 'rtl' | 'ltr'; screens: FlowPreviewScreen[] }

function previewComponent(field: FlowFieldDraft): FlowPreviewComponent {
  const label = field.label.trim()
  switch (field.kind) {
    case 'heading': case 'subheading': case 'text': case 'caption':
      return { kind: field.kind, text: field.text.trim() }
    case 'text_input': case 'text_area': case 'date':
      return { kind: field.kind, label, required: field.required, helper: orNull(field.helperText) }
    case 'dropdown': case 'radio': case 'checkbox':
      return { kind: field.kind, label, required: field.required, options: field.options.map(option => ({ title: option.title.trim(), description: orNull(option.description) })) }
    case 'opt_in':
      return { kind: field.kind, label, required: field.required }
  }
}

/** What the live preview shows: the draft as typed (nothing is validated), in the language's own direction. */
export function flowPreviewModel(draft: FlowDraft): FlowPreviewModel {
  return {
    direction: templateDirection(draft.language),
    screens: draft.screens.map(screen => ({ title: screen.title.trim(), footer: screen.footerLabel.trim(), components: screen.fields.map(previewComponent) })),
  }
}

// ---------------------------------------------------------------- answers

export type AnswerDisplay = { kind: 'text'; text: string } | { kind: 'boolean'; value: boolean }

/** An answer ready to show: its text, the titles of the chosen options joined, a date, or a yes / no. */
export function answerDisplay(answer: InboxFlowAnswer): AnswerDisplay {
  if ('choices' in answer) return { kind: 'text', text: answer.choices.map(choice => choice.title).join('، ') }
  if (answer.kind === 'opt_in') return { kind: 'boolean', value: answer.value }
  return { kind: 'text', text: answer.value }
}

export interface AnswerColumn { key: string; label: string }

/**
 * The columns of a responses table: the answer fields of the form in their order when WebVue can read its screens,
 * then any key the answers carry that the form does not list (an answer of an older version, or of an external form).
 */
export function answerColumns(flow: InboxFlow | undefined, submissions: ReadonlyArray<{ answers: readonly InboxFlowAnswer[] }>): AnswerColumn[] {
  const columns = new Map<string, string>()
  for (const screen of flow?.screens ?? []) {
    for (const field of screen.fields) if ('key' in field) columns.set(field.key, field.label)
  }
  for (const submission of submissions) {
    for (const answer of submission.answers) if (!columns.has(answer.key)) columns.set(answer.key, answer.label)
  }
  return [...columns].map(([key, label]) => ({ key, label }))
}

export const answerOf = (answers: readonly InboxFlowAnswer[], key: string) => answers.find(answer => answer.key === key)

// ---------------------------------------------------------------- starter forms

/** The sector starter forms offered when a form is created; they are created as drafts and never published automatically. */
export const FLOW_STARTERS = ['clinic', 'store', 'public_service'] as const
export type FlowStarterKey = typeof FLOW_STARTERS[number]

type StarterField =
  | { id: string; kind: 'text_input'; key: string; inputType?: InboxFlowInputType; sensitive?: boolean; required?: boolean }
  | { id: string; kind: 'text_area' | 'date' | 'opt_in'; key: string; required?: boolean }
  | { id: string; kind: 'dropdown' | 'radio'; key: string; options: number }
  | { id: string; kind: 'text' }
interface StarterScreen { id: string; fields: StarterField[] }
interface StarterSpec { category: InboxFlowCategory; screens: StarterScreen[] }

// Their texts are the locale's `inbox.flows.starters.<key>.<screen>.<field>.label` (and `.o<n>` for a choice), so they
// read in the language of the interface; the structure and the keys of the answers are fixed here.
export const STARTER_SPECS: Record<FlowStarterKey, StarterSpec> = {
  clinic: {
    category: 'appointment_booking',
    screens: [
      { id: 's1', fields: [
        { id: 'f1', kind: 'text_input', key: 'full_name' },
        { id: 'f2', kind: 'text_input', key: 'phone', inputType: 'phone' },
      ] },
      { id: 's2', fields: [
        { id: 'f1', kind: 'dropdown', key: 'service', options: 3 },
        { id: 'f2', kind: 'date', key: 'preferred_date' },
        { id: 'f3', kind: 'radio', key: 'period', options: 2 },
        { id: 'f4', kind: 'text_area', key: 'notes', required: false },
      ] },
    ],
  },
  store: {
    category: 'customer_support',
    screens: [
      { id: 's1', fields: [
        { id: 'f1', kind: 'text_input', key: 'order_number', required: false },
        { id: 'f2', kind: 'dropdown', key: 'topic', options: 4 },
        { id: 'f3', kind: 'text_area', key: 'details' },
        { id: 'f4', kind: 'opt_in', key: 'contact_consent' },
      ] },
    ],
  },
  public_service: {
    category: 'contact_us',
    screens: [
      { id: 's1', fields: [
        { id: 'f1', kind: 'text_input', key: 'full_name' },
        { id: 'f2', kind: 'text_input', key: 'national_id', inputType: 'number', sensitive: true },
        { id: 'f3', kind: 'text_input', key: 'phone', inputType: 'phone' },
      ] },
      { id: 's2', fields: [
        { id: 'f1', kind: 'dropdown', key: 'request_type', options: 3 },
        { id: 'f2', kind: 'text_area', key: 'details' },
        { id: 'f3', kind: 'opt_in', key: 'confirm_data' },
      ] },
    ],
  },
}

/** A starter's draft; `translate` returns the text of a locale key (a missing optional text is the key itself and is dropped). */
export function starterDraft(key: FlowStarterKey, defaults: FlowDefaults, translate: (key: string) => string, language = 'ar'): FlowDraft {
  const spec = STARTER_SPECS[key]
  const base = `inbox.flows.starters.${key}`
  const draft: FlowDraft = { name: translate(`${base}.name`), category: spec.category, language, completionMessage: translate(`${base}.completion`), screens: [] }
  spec.screens.forEach((screen, index) => {
    const target = emptyScreen(translate(`${base}.${screen.id}.title`), footerLabelFor(defaults, index === spec.screens.length - 1))
    draft.screens.push(target)
    for (const item of screen.fields) {
      const path = `${base}.${screen.id}.${item.id}`
      const field = addField(draft, index, item.kind)!
      if (item.kind === 'text') { field.text = translate(`${path}.text`); continue }
      field.key = item.key
      field.label = translate(`${path}.label`)
      if ('required' in item && item.required !== undefined) field.required = item.required
      if (item.kind === 'text_input') {
        field.inputType = item.inputType ?? 'text'
        field.sensitive = item.sensitive ?? false
      }
      if (item.kind === 'dropdown' || item.kind === 'radio') {
        field.options = Array.from({ length: item.options }, (_, n) => emptyOption(translate(`${path}.o${n + 1}`)))
      }
    }
  })
  return draft
}
