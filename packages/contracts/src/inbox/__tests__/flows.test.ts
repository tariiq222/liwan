import {
  InboxFlowAnswerSchema,
  InboxFlowCopySchema,
  InboxFlowInteractiveSchema,
  InboxFlowPreviewSchema,
  InboxFlowSchema,
  InboxFlowSubmissionSchema,
  InboxFlowWriteSchema,
  InboxInteractiveSchema,
  InboxMessageKindSchema,
  InboxRuleTestSchema,
  InboxRuleWriteSchema,
  InboxTemplateButtonSchema,
  InboxTemplateButtonWriteSchema,
  InboxTemplateWriteSchema,
} from '../index'

const INPUT = {
  kind: 'text_input', key: 'full_name', label: 'Name', required: true, sensitive: false, input_type: 'text',
  helper_text: null, min_chars: null, max_chars: null,
}
const dropdown = (key: string, titles: string[]) => ({
  kind: 'dropdown', key, label: key, required: true, sensitive: false,
  options: titles.map(title => ({ title, description: null })),
})
const form = (fields: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'Visit', category: 'appointment_booking', language: 'ar', completion_message: null,
  screens: [{ title: 'Details', footer_label: 'Send', fields }], ...extra,
})
const valid = (fields: unknown[]) => InboxFlowWriteSchema.safeParse(form(fields)).success

describe('InboxFlowWriteSchema', () => {
  it('accepts a form with one of every common kind', () => {
    expect(valid([
      { kind: 'heading', text: 'Book' }, { kind: 'subheading', text: 'Now' }, { kind: 'text', text: 'Body' }, { kind: 'caption', text: 'Small' },
      INPUT,
      { kind: 'text_area', key: 'notes', label: 'Notes', required: false, sensitive: true, helper_text: 'Hi', max_length: 600 },
      dropdown('service', ['A', 'B']),
      { kind: 'radio', key: 'pick', label: 'Pick', required: true, sensitive: false, options: [{ title: 'A', description: 'First' }] },
      {
        kind: 'checkbox', key: 'extras', label: 'Extras', required: false, sensitive: false, min_selected: 1, max_selected: 2,
        options: [{ title: 'A', description: null }, { title: 'B', description: null }],
      },
      { kind: 'date', key: 'day', label: 'Day', required: true, sensitive: false, helper_text: null, min_date: '2026-11-01', max_date: '2026-12-01' },
      { kind: 'opt_in', key: 'consent', label: 'I agree', required: true },
    ])).toBe(true)
  })

  it('rejects unknown keys and unknown kinds', () => {
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { extra: 1 })).success).toBe(false)
    expect(valid([{ ...INPUT, extra: 1 }])).toBe(false)
    expect(valid([INPUT, { kind: 'image', src: 'x' }])).toBe(false)
    expect(valid([INPUT, { kind: 'opt_in', key: 'c', label: 'x', required: true, sensitive: false }])).toBe(false)
  })

  it('checks Meta limits per kind', () => {
    expect(valid([INPUT, { kind: 'heading', text: 'x'.repeat(81) }])).toBe(false)
    expect(valid([INPUT, { kind: 'caption', text: 'x'.repeat(410) }])).toBe(false)
    expect(valid([{ ...INPUT, label: 'x'.repeat(21) }])).toBe(false)
    expect(valid([{ ...INPUT, helper_text: 'x'.repeat(81) }])).toBe(false)
    expect(valid([{ ...INPUT, max_chars: 4097 }])).toBe(false)
    expect(valid([dropdown('d', Array.from({ length: 201 }, (_, i) => `t${i}`))])).toBe(false)
    expect(valid([{ kind: 'radio', key: 'r', label: 'r', required: true, sensitive: false,
      options: Array.from({ length: 21 }, (_, i) => ({ title: `t${i}`, description: null })) }])).toBe(false)
    expect(valid([{ kind: 'opt_in', key: 'c', label: 'x'.repeat(121), required: true }])).toBe(false)
    expect(valid([{ kind: 'text_area', key: 'a', label: 'a', required: true, sensitive: false, helper_text: null, max_length: 601 }])).toBe(false)
  })

  it('checks the screen shape', () => {
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: [] })).success).toBe(false)
    const screen = { title: 'T', footer_label: 'Go', fields: [INPUT] }
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: [{ ...screen, fields: [] }] })).success).toBe(false)
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: [{ ...screen, footer_label: 'x'.repeat(36) }] })).success).toBe(false)
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: [{ ...screen, title: 'x'.repeat(81) }] })).success).toBe(false)
  })

  it('accepts at most ten screens', () => {
    const screens = (count: number) => Array.from({ length: count }, (_, i) => ({
      title: `S${i}`, footer_label: 'Go', fields: [{ ...INPUT, key: `field_${i}` }],
    }))
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: screens(10) })).success).toBe(true)
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { screens: screens(11) })).success).toBe(false)
  })

  it('checks answer keys', () => {
    for (const key of ['Name', '1name', 'a-b', 'x'.repeat(41), '', 'flow_token']) expect(valid([{ ...INPUT, key }])).toBe(false)
    expect(valid([{ ...INPUT, key: 'x'.repeat(40) }])).toBe(true)
    expect(valid([INPUT, { ...INPUT }])).toBe(false)
  })

  it('needs at least one field that collects an answer', () => {
    expect(valid([{ kind: 'heading', text: 'Only text' }])).toBe(false)
  })

  it('allows at most five opt-in boxes per screen', () => {
    const optIns = (count: number) => Array.from({ length: count }, (_, i) => ({ kind: 'opt_in', key: `c${i}`, label: 'x', required: false }))
    expect(valid(optIns(5))).toBe(true)
    expect(valid(optIns(6))).toBe(false)
  })

  it('checks min and max characters, selection limits and date ranges', () => {
    expect(valid([{ ...INPUT, min_chars: 10, max_chars: 5 }])).toBe(false)
    expect(valid([{ ...INPUT, min_chars: 5, max_chars: 5 }])).toBe(true)
    const checkbox = (min: number | null, max: number | null) => ({
      kind: 'checkbox', key: 'c', label: 'c', required: false, sensitive: false, min_selected: min, max_selected: max,
      options: [{ title: 'A', description: null }, { title: 'B', description: null }],
    })
    expect(valid([checkbox(3, null)])).toBe(false)
    expect(valid([checkbox(null, 3)])).toBe(false)
    expect(valid([checkbox(2, 1)])).toBe(false)
    expect(valid([checkbox(1, 2)])).toBe(true)
    const date = (min: string | null, max: string | null) => ({
      kind: 'date', key: 'd', label: 'd', required: true, sensitive: false, helper_text: null, min_date: min, max_date: max,
    })
    expect(valid([date('2026-12-01', '2026-11-01')])).toBe(false)
    expect(valid([date('2026-11-01', '2026-12-01')])).toBe(true)
    expect(valid([date('01/11/2026', null)])).toBe(false)
  })

  it('needs unique choice titles per field and caps the choices of a form', () => {
    expect(valid([dropdown('d', ['A', 'A'])])).toBe(false)
    const big = (count: number) => Array.from({ length: count }, (_, i) => dropdown(`d${i}`, Array.from({ length: 200 }, (_, n) => `t${n}`)))
    expect(valid(big(5))).toBe(true)
    expect(valid(big(6))).toBe(false)
  })

  it('checks the settings', () => {
    for (const patch of [{ name: '' }, { name: 'x'.repeat(129) }, { language: 'arabic' }, { category: 'sales' }, { completion_message: '' }]) {
      expect(InboxFlowWriteSchema.safeParse(form([INPUT], patch)).success).toBe(false)
    }
    expect(InboxFlowWriteSchema.safeParse(form([INPUT], { language: 'en_US', completion_message: 'Thanks' })).success).toBe(true)
  })
})

describe('InboxFlowSchema', () => {
  const FLOW = {
    id: 1, channel: { id: 2, name: 'Main' }, name: 'Visit', category: 'other', language: 'ar', status: 'draft', health: 'unknown',
    provider_flow_id: '700', json_version: '7.3', supported: true, editable: true, sendable: false, error_count: 1, submission_count: 0,
    version_warning: null, published_at: null, updated_at: '2026-10-29T09:00:00Z', completion_message: null, replaces: null,
    screens: [{
      id: 3, key: 'SCREEN_A', title: 'Details', footer_label: 'Send',
      fields: [
        { id: 4, ...INPUT },
        { id: 5, ...dropdown('service', ['A']), options: [{ key: 'o1', title: 'A', description: null }] },
        { id: 6, kind: 'opt_in', key: 'consent', label: 'I agree', required: true },
      ],
    }],
    validation_errors: [{ message: 'Bad', path: 'screens[0]', line: 3, column: 4 }],
  }

  it('accepts the read shape and rejects extra keys', () => {
    expect(InboxFlowSchema.parse(FLOW).screens[0].fields).toHaveLength(3)
    expect(() => InboxFlowSchema.parse({ ...FLOW, secret: 1 })).toThrow()
    expect(() => InboxFlowSchema.parse({ ...FLOW, status: 'deleted' })).toThrow()
    expect(() => InboxFlowSchema.parse({ ...FLOW, updated_at: '2026-10-29 09:00' })).toThrow()
  })
})

describe('copy and preview', () => {
  it('validates the bodies', () => {
    expect(InboxFlowCopySchema.safeParse({ name: 'Visit 2', replace: true }).success).toBe(true)
    expect(InboxFlowCopySchema.safeParse({ name: 'Visit 2' }).success).toBe(false)
    expect(InboxFlowPreviewSchema.safeParse({ url: 'https://business.facebook.com/p', expires_at: '2026-11-28T10:00:00Z' }).success).toBe(true)
    expect(InboxFlowPreviewSchema.safeParse({ url: 'http://example.com', expires_at: '2026-11-28T10:00:00Z' }).success).toBe(false)
  })
})

describe('answers', () => {
  it('is typed by the kind of the field', () => {
    for (const answer of [
      { key: 'a', label: 'A', kind: 'text_input', value: 'Sara' },
      { key: 'a', label: 'A', kind: 'unknown', value: '5' },
      { key: 'a', label: 'A', kind: 'checkbox', choices: [{ key: 'o1', title: 'X' }] },
      { key: 'a', label: 'A', kind: 'date', value: '2026-11-20' },
      { key: 'a', label: 'A', kind: 'opt_in', value: true },
    ]) expect(InboxFlowAnswerSchema.safeParse(answer).success).toBe(true)
    expect(InboxFlowAnswerSchema.safeParse({ key: 'a', label: 'A', kind: 'date', value: 'tomorrow' }).success).toBe(false)
    expect(InboxFlowAnswerSchema.safeParse({ key: 'a', label: 'A', kind: 'opt_in', value: 'yes' }).success).toBe(false)
    expect(InboxFlowAnswerSchema.safeParse({ key: 'a', label: 'A', kind: 'dropdown', value: 'x' }).success).toBe(false)
  })

  it('makes a submission whose form may be unknown', () => {
    const submission = {
      id: 1, flow: null, conversation_id: 2, contact: { id: 3, name: 'Sara' }, request_message_id: null, message_id: 4,
      submitted_at: '2026-10-29T09:00:00Z', answers: [{ key: 'a', label: 'a', kind: 'unknown', value: 'x' }],
    }
    expect(InboxFlowSubmissionSchema.safeParse(submission).success).toBe(true)
    expect(InboxFlowSubmissionSchema.safeParse({ ...submission, extra: 1 }).success).toBe(false)
  })
})

describe('sending a form', () => {
  const FLOW_MESSAGE = { type: 'flow', body: 'Please fill in', header: null, footer: null, flow_id: 5, cta: 'Open' }

  it('is a member of the interactive union', () => {
    expect(InboxFlowInteractiveSchema.safeParse(FLOW_MESSAGE).success).toBe(true)
    expect(InboxInteractiveSchema.safeParse(FLOW_MESSAGE).success).toBe(true)
    expect(InboxInteractiveSchema.safeParse({ ...FLOW_MESSAGE, cta: 'x'.repeat(31) }).success).toBe(false)
    expect(InboxInteractiveSchema.safeParse({ ...FLOW_MESSAGE, flow_id: 0 }).success).toBe(false)
    expect(InboxInteractiveSchema.safeParse({ ...FLOW_MESSAGE, extra: 1 }).success).toBe(false)
  })

  it('adds the form answer message kind', () => {
    expect(InboxMessageKindSchema.safeParse('flow_response').success).toBe(true)
  })

  it('adds the form button to templates', () => {
    expect(InboxTemplateButtonSchema.safeParse({ type: 'flow', text: 'Open', flow: { id: 1, name: 'Visit' }, provider_flow_id: '700' }).success).toBe(true)
    expect(InboxTemplateButtonSchema.safeParse({ type: 'flow', text: 'Open', flow: null, provider_flow_id: '700' }).success).toBe(true)
    expect(InboxTemplateButtonWriteSchema.safeParse({ type: 'flow', text: 'Open', flow_id: 1 }).success).toBe(true)
    expect(InboxTemplateButtonWriteSchema.safeParse({ type: 'flow', text: 'x'.repeat(26), flow_id: 1 }).success).toBe(false)
    const template = (buttons: unknown[]) => InboxTemplateWriteSchema.safeParse({
      name: 'invite', language: 'ar', category: 'utility', allow_category_change: false, header: null,
      body: 'Hello', body_examples: [], footer: null, buttons,
    }).success
    const flow = { type: 'flow', text: 'Open', flow_id: 1 }
    expect(template([flow])).toBe(true)
    expect(template([flow, flow])).toBe(false)
  })
})

describe('rules on a submitted form', () => {
  const RULE = {
    channel_id: null, name: 'On form', active: true, match_kind: 'flow', keywords: [], option_id: null, flow_id: 3, hours: 'any', stop: true,
    reply: { body: 'Thanks' }, resolve: false, department_id: null, assignee_id: null, tag_ids: [], priority: null,
  }

  it('needs a form for the flow kind and none for the others', () => {
    expect(InboxRuleWriteSchema.safeParse(RULE).success).toBe(true)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, flow_id: null }).success).toBe(false)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, keywords: ['x'] }).success).toBe(false)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, option_id: 'a' }).success).toBe(false)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, match_kind: 'contains', keywords: ['x'] }).success).toBe(false)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, match_kind: 'any' }).success).toBe(false)
    expect(InboxRuleWriteSchema.safeParse({ ...RULE, match_kind: 'any', flow_id: null }).success).toBe(true)
  })

  it('takes the form in the dry run', () => {
    const test = { channel_id: 1, text: null, option_id: null, flow_id: 3, at: null }
    expect(InboxRuleTestSchema.safeParse(test).success).toBe(true)
    expect(InboxRuleTestSchema.safeParse({ ...test, flow_id: undefined }).success).toBe(false)
  })
})
