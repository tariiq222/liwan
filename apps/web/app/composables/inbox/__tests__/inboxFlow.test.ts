import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxFlowSchema, InboxFlowSubmissionSchema } from '@liwan/contracts'
import { inboxPreviewData, resetInboxPreview } from '../../../../e2e/inbox-ui-preview-data.mjs'
import {
  FLOW_LIMITS, FLOW_STARTERS, addField, answerColumns, answerDisplay, blankFlowDraft, conversationRoute, emptyField, emptyOption, fieldProblems, flowIsSendable, flowPreviewModel,
  flowResponsesRoute, flowToDraft, flowWriteCandidate, flowsRoute, formProblems, locateMetaError, moveToIndex, nextFieldKey, placeMetaErrors, screenProblems, starterDraft,
  validateFlowDraft, writeField, type FlowDefaults, type FlowDraft,
} from '../inboxFlow'

const defaults: FlowDefaults = { screenTitle: 'بياناتك', fieldLabel: 'الاسم', footerNext: 'التالي', footerSubmit: 'إرسال' }
const valid = (): FlowDraft => ({ ...blankFlowDraft(defaults), name: 'طلب' })
const load = (lang: 'ar' | 'en') => JSON.parse(readFileSync(new URL(`../../../../i18n/locales/${lang}/inbox.json`, import.meta.url), 'utf8')) as Record<string, unknown>
const lookup = (messages: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages) as string

describe('a new form', () => {
  it('is one screen with one text question, valid once it has a name', () => {
    const draft = blankFlowDraft(defaults, 'en')
    expect(draft).toMatchObject({ language: 'en', screens: [{ title: 'بياناتك', footerLabel: 'إرسال', fields: [{ kind: 'text_input', key: 'field_1', label: 'الاسم' }] }] })
    expect(validateFlowDraft(draft)).toMatchObject({ ok: false })
    expect(validateFlowDraft({ ...draft, name: 'طلب' }).ok).toBe(true)
  })

  it('names new answer fields field_<n>, filling the smallest free number', () => {
    const draft = valid()
    expect(nextFieldKey(draft)).toBe('field_2')
    addField(draft, 0, 'date')
    addField(draft, 0, 'heading')
    expect(draft.screens[0]!.fields.map(field => field.key)).toEqual(['field_1', 'field_2', ''])
    draft.screens[0]!.fields.splice(0, 1)
    expect(nextFieldKey(draft)).toBe('field_1')
  })

  it('refuses a 50th component on a screen and a screen that does not exist', () => {
    const draft = valid()
    for (let n = 0; n < FLOW_LIMITS.fieldsPerScreen - 1; n++) addField(draft, 0, 'text')
    expect(draft.screens[0]!.fields).toHaveLength(FLOW_LIMITS.fieldsPerScreen)
    expect(addField(draft, 0, 'text')).toBeNull()
    expect(addField(draft, 3, 'text')).toBeNull()
  })

  it('makes a required question, an optional consent and two empty choices', () => {
    expect(emptyField('text_input').required).toBe(true)
    expect(emptyField('opt_in').required).toBe(false)
    expect(emptyField('heading').required).toBe(false)
    expect(emptyField('radio').options).toHaveLength(2)
    expect(emptyField('date').options).toEqual([])
  })
})

describe('the wire shape', () => {
  it('sends exactly the properties of each kind (the contract objects are strict)', () => {
    const field = (kind: Parameters<typeof emptyField>[0], extra: object = {}) => writeField({ ...emptyField(kind), key: 'k', label: 'ل', text: 'ن', ...extra })
    expect(Object.keys(field('heading'))).toEqual(['kind', 'text'])
    expect(Object.keys(field('text_input'))).toEqual(['kind', 'key', 'label', 'required', 'sensitive', 'input_type', 'helper_text', 'min_chars', 'max_chars'])
    expect(Object.keys(field('text_area'))).toEqual(['kind', 'key', 'label', 'required', 'sensitive', 'helper_text', 'max_length'])
    expect(Object.keys(field('dropdown'))).toEqual(['kind', 'key', 'label', 'required', 'sensitive', 'options'])
    expect(Object.keys(field('checkbox'))).toEqual(['kind', 'key', 'label', 'required', 'sensitive', 'min_selected', 'max_selected', 'options'])
    expect(Object.keys(field('date'))).toEqual(['kind', 'key', 'label', 'required', 'sensitive', 'helper_text', 'min_date', 'max_date'])
    expect(Object.keys(field('opt_in'))).toEqual(['kind', 'key', 'label', 'required'])
  })

  it('reads an empty counter as "not set" and trims texts', () => {
    const write = writeField({ ...emptyField('text_input'), key: ' k ', label: ' ل ', minChars: '', maxChars: ' 12 ', helperText: '  ' })
    expect(write).toMatchObject({ key: 'k', label: 'ل', min_chars: null, max_chars: 12, helper_text: null })
  })

  it('round-trips a stored form to the same write body', () => {
    resetInboxPreview()
    const answer = inboxPreviewData('GET', '/api/v1/inbox/flows/1', new URL('http://x/api/v1/inbox/flows/1')) as { body: unknown }
    const flow = InboxFlowSchema.parse(answer.body)
    const draft = flowToDraft(flow)
    const result = validateFlowDraft(draft)
    expect(result.ok).toBe(true)
    const candidate = flowWriteCandidate(draft) as { screens: Array<{ fields: Array<Record<string, unknown>> }> }
    expect(candidate.screens).toHaveLength(flow.screens.length)
    expect(candidate.screens[1]!.fields.map(field => field.kind)).toEqual(['dropdown', 'date', 'radio', 'opt_in'])
    expect(candidate.screens[1]!.fields[0]).toMatchObject({ options: [{ title: 'كشف', description: null }, { title: 'متابعة', description: 'لمراجعين سابقين' }, { title: 'استشارة', description: null }] })
    expect(candidate).toMatchObject({ completion_message: 'وصلنا طلبك وسنؤكد الموعد قريبًا.' })
  })
})

describe('problems', () => {
  it('places an over-long label on its field and an empty screen title on its screen', () => {
    const draft = valid()
    draft.screens[0]!.fields[0]!.label = 'x'.repeat(21)
    draft.screens[0]!.title = ''
    const result = validateFlowDraft(draft)
    if (result.ok) throw new Error('expected problems')
    expect(fieldProblems(result.problems, 0, 0)).toEqual([{ screen: 0, field: 0, prop: 'label', code: 'invalid' }])
    expect(screenProblems(result.problems, 0)).toEqual([{ screen: 0, field: null, prop: 'title', code: 'invalid' }])
  })

  it('names the form-level problems: name, no answer field, empty screen', () => {
    const draft = valid()
    draft.name = ''
    const named = validateFlowDraft(draft)
    expect(named.ok ? [] : formProblems(named.problems)).toEqual([{ screen: null, field: null, prop: 'name', code: 'invalid' }])
    draft.name = 'x'
    draft.screens[0]!.fields[0] = { ...emptyField('heading'), text: 'عنوان' }
    expect(validateFlowDraft(draft)).toMatchObject({ ok: false, problems: [{ code: 'noInput', screen: null }] })
    draft.screens[0]!.fields = []
    const empty = validateFlowDraft(draft)
    expect(empty.ok ? [] : empty.problems.map(problem => problem.code)).toContain('noFields')
  })

  it('marks every field that repeats a key, and the reserved flow_token', () => {
    const draft = valid()
    addField(draft, 0, 'date')
    draft.screens[0]!.fields[1]!.label = 'تاريخ'
    draft.screens[0]!.fields[1]!.key = 'field_1'
    const repeated = validateFlowDraft(draft)
    expect(repeated.ok ? [] : repeated.problems.filter(problem => problem.code === 'duplicateKeys').map(problem => problem.field)).toEqual([0, 1])
    draft.screens[0]!.fields[1]!.key = 'flow_token'
    const reserved = validateFlowDraft(draft)
    expect(reserved.ok ? [] : reserved.problems).toContainEqual({ screen: 0, field: 1, prop: 'key', code: 'invalid' })
  })

  it('points the selection, range and duplicate-choice rules at their field', () => {
    const draft = valid()
    const box = addField(draft, 0, 'checkbox')!
    box.label = 'اختر'
    box.options = [emptyOption('أ'), emptyOption('أ')]
    box.minSelected = '3'
    const result = validateFlowDraft(draft)
    const codes = result.ok ? [] : fieldProblems(result.problems, 0, 1).map(problem => problem.code)
    expect(codes).toEqual(expect.arrayContaining(['selection', 'duplicateOptions']))
    const text = valid()
    text.screens[0]!.fields[0] = { ...text.screens[0]!.fields[0]!, minChars: '9', maxChars: '3' }
    expect(validateFlowDraft(text)).toMatchObject({ ok: false, problems: [{ screen: 0, field: 0, code: 'minChars' }] })
  })

  it('refuses more than 5 consent boxes on a screen and more than 10 screens', () => {
    const draft = valid()
    for (let n = 0; n < 6; n++) { const box = addField(draft, 0, 'opt_in')!; box.label = `م${n}` }
    expect(validateFlowDraft(draft)).toMatchObject({ ok: false, problems: [{ code: 'optInCap' }] })
  })
})

describe('Meta\'s validation errors', () => {
  const draft = (() => { const value = valid(); addField(value, 0, 'date'); return value })()

  it('finds the field by the child index of the generated JSON, and the footer after the last field', () => {
    expect(locateMetaError('$.screens[0].layout.children[1].label', draft)).toEqual({ screen: 0, field: 1 })
    expect(locateMetaError('$.screens[0].layout.children[2]', draft)).toEqual({ screen: 0, field: 'footer' })
    expect(locateMetaError('$.screens[0].layout.children[7]', draft)).toEqual({ screen: 0, field: null })
    expect(locateMetaError('$.screens[0]', draft)).toEqual({ screen: 0, field: null })
  })

  it('leaves an error outside the screens, with no path, or for a missing screen to the form\'s alert', () => {
    expect(locateMetaError('$.version', draft)).toBeNull()
    expect(locateMetaError(null, draft)).toBeNull()
    expect(locateMetaError('$.screens[4].layout', draft)).toBeNull()
    const split = placeMetaErrors([{ path: '$.screens[0].layout.children[0]' }, { path: '$.routing_model' }, { path: null }], draft)
    expect(split.placed).toHaveLength(1)
    expect(split.loose).toHaveLength(2)
  })
})

describe('reorder', () => {
  it('moves one item to a position and ignores a position outside the list', () => {
    expect(moveToIndex(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveToIndex(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveToIndex(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveToIndex(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('preview model', () => {
  it('follows the form\'s language direction and lists the components as typed', () => {
    const draft = valid()
    const dropdown = addField(draft, 0, 'dropdown')!
    dropdown.label = 'الخدمة'
    dropdown.options = [emptyOption('أ', 'وصف'), emptyOption('ب')]
    expect(flowPreviewModel(draft).direction).toBe('rtl')
    expect(flowPreviewModel({ ...draft, language: 'en_US' }).direction).toBe('ltr')
    expect(flowPreviewModel(draft).screens[0]).toMatchObject({
      title: 'بياناتك', footer: 'إرسال',
      components: [{ kind: 'text_input', label: 'الاسم', required: true }, { kind: 'dropdown', label: 'الخدمة', options: [{ title: 'أ', description: 'وصف' }, { title: 'ب', description: null }] }],
    })
  })

  it('shows an unfinished draft as it is, without validating', () => {
    const draft = valid()
    draft.screens[0]!.fields[0]!.label = ''
    expect(flowPreviewModel(draft).screens[0]!.components[0]).toMatchObject({ kind: 'text_input', label: '' })
  })
})

describe('answers', () => {
  const submission = () => {
    resetInboxPreview()
    const body = (inboxPreviewData('GET', '/api/v1/inbox/flows/1/submissions', new URL('http://x/api/v1/inbox/flows/1/submissions')) as { body: unknown }).body as { items: unknown[] }
    return InboxFlowSubmissionSchema.parse(body.items[0])
  }

  it('shows text as it is, the chosen titles joined, and a consent as a yes or no', () => {
    const { answers } = submission()
    expect(answerDisplay(answers[0]!)).toEqual({ kind: 'text', text: 'ليلى القحطاني' })
    expect(answerDisplay(answers[2]!)).toEqual({ kind: 'text', text: 'متابعة' })
    expect(answerDisplay({ key: 'k', label: 'ل', kind: 'checkbox', choices: [{ key: 'o1', title: 'أ' }, { key: 'o2', title: 'ب' }] })).toEqual({ kind: 'text', text: 'أ، ب' })
    expect(answerDisplay(answers[3]!)).toEqual({ kind: 'text', text: '2026-11-05' })
    expect(answerDisplay(answers[5]!)).toEqual({ kind: 'boolean', value: true })
  })

  it('builds the table columns from the form\'s answer fields in order, then any key only the answers carry', () => {
    const { answers } = submission()
    const flow = InboxFlowSchema.parse((inboxPreviewData('GET', '/api/v1/inbox/flows/1', new URL('http://x/api/v1/inbox/flows/1')) as { body: unknown }).body)
    expect(answerColumns(flow, [{ answers }]).map(column => column.key)).toEqual(['full_name', 'phone', 'service', 'preferred_date', 'period', 'consent'])
    const extra = { answers: [...answers, { key: 'old_field', label: 'قديم', kind: 'unknown' as const, value: 'x' }] }
    expect(answerColumns(flow, [extra]).at(-1)).toEqual({ key: 'old_field', label: 'قديم' })
    expect(answerColumns(undefined, [{ answers }]).map(column => column.key)).toEqual(answers.map(answer => answer.key))
  })
})

describe('routes', () => {
  it('builds the settings, responses and conversation links, keeping the query', () => {
    expect(flowsRoute(4, { status: 'draft' }, '/new')).toEqual({ path: '/settings/apps/inbox/channels/4/flows/new', query: { status: 'draft' } })
    expect(flowResponsesRoute(9)).toEqual({ path: '/inbox/flows/9', query: {} })
    expect(conversationRoute(5, 17, { state: 'open' })).toEqual({ path: '/inbox/5', query: { state: 'open', message: '17' } })
    expect(conversationRoute(5)).toEqual({ path: '/inbox/5', query: {} })
    expect(flowIsSendable({ sendable: true })).toBe(true)
  })
})

describe.each(['ar', 'en'] as const)('sector starter forms in %s', (lang) => {
  const messages = load(lang)
  const text = (key: string) => lookup(messages, key)
  const defaultsOf: FlowDefaults = { screenTitle: text('inbox.flows.defaults.screenTitle'), fieldLabel: text('inbox.flows.defaults.fieldLabel'), footerNext: text('inbox.flows.defaults.next'), footerSubmit: text('inbox.flows.defaults.submit') }

  it.each(FLOW_STARTERS)('%s is a valid draft within every limit', (key) => {
    const draft = starterDraft(key, defaultsOf, text, lang)
    const result = validateFlowDraft(draft)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(draft.name).toBe(text(`inbox.flows.starters.${key}.name`))
    expect(draft.screens.at(-1)!.footerLabel).toBe(defaultsOf.footerSubmit)
    if (draft.screens.length > 1) expect(draft.screens[0]!.footerLabel).toBe(defaultsOf.footerNext)
  })

  it('marks the national id of the public service form sensitive', () => {
    const draft = starterDraft('public_service', defaultsOf, text, lang)
    expect(draft.screens[0]!.fields.find(field => field.key === 'national_id')).toMatchObject({ sensitive: true, inputType: 'number' })
  })
})
