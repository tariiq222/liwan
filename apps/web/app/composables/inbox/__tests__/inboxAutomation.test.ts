import { describe, expect, it } from 'vitest'
import type { InboxInteractive, InboxRule } from '@webvue/contracts'
import {
  autoContentToDraft, automationToDraft, automationWrite, buildAutoContent, draftToHours, emptyAutoContentDraft, emptyHoursDraft, emptyRuleDraft,
  hoursToDraft, hoursValid, moveRuleId, overlappingWeekdays, ruleActionKeys, ruleToDraft, ruleWrite, ruleWriteCandidate, timezoneChoices,
} from '../inboxAutomation'
import { buildInteractive, emptyInteractiveDraft, interactiveToDraft } from '../inboxInteractive'

const BUTTONS: InboxInteractive = { type: 'buttons', body: 'اختر', header: null, footer: 'عيادة', buttons: [{ id: 'btn_1', title: 'حجز' }, { id: 'btn_2', title: 'استفسار' }] }

describe('working hours draft', () => {
  const hours = {
    timezone: 'Asia/Riyadh',
    days: [{ weekday: 6, from: '09:00', to: '12:00' }, { weekday: 6, from: '14:00', to: '17:00' }, { weekday: 0, from: '08:00', to: '16:00' }],
    holidays: [{ name: 'اليوم الوطني', date_from: '2026-09-23', date_to: '2026-09-23' }],
  }

  it('groups the ranges by weekday and gives the same hours back', () => {
    const draft = hoursToDraft(hours)
    expect(draft.week[6]).toHaveLength(2)
    expect(draft.week[0]).toEqual([{ from: '08:00', to: '16:00' }])
    expect(draft.week[2]).toEqual([])
    expect(draftToHours(draft).days).toEqual(expect.arrayContaining(hours.days))
    expect(draftToHours(draft).holidays).toEqual(hours.holidays)
  })

  it('is valid with no range at all (always open) and rejects a range that ends before it starts', () => {
    expect(hoursValid(emptyHoursDraft())).toBe(true)
    const draft = hoursToDraft(hours)
    draft.week[1] = [{ from: '17:00', to: '09:00' }]
    expect(hoursValid(draft)).toBe(false)
  })

  it('finds the days whose ranges overlap', () => {
    const draft = emptyHoursDraft()
    draft.week[3] = [{ from: '09:00', to: '13:00' }, { from: '12:00', to: '17:00' }]
    draft.week[4] = [{ from: '09:00', to: '12:00' }, { from: '12:00', to: '17:00' }]
    expect(overlappingWeekdays(draft)).toEqual([3])
    expect(hoursValid(draft)).toBe(false)
  })

  it('keeps a saved timezone that is not in the short list', () => {
    expect(timezoneChoices('Asia/Riyadh')).not.toContain('Pacific/Auckland')
    expect(timezoneChoices('Pacific/Auckland')[0]).toBe('Pacific/Auckland')
  })
})

describe('automatic message content', () => {
  it('builds text, trimmed, and nothing for an empty text', () => {
    const draft = { ...emptyAutoContentDraft(), body: '  أهلًا  ' }
    expect(buildAutoContent(draft)).toEqual({ body: 'أهلًا' })
    expect(buildAutoContent(emptyAutoContentDraft())).toBeNull()
  })

  it('round-trips an interactive message through the builder draft', () => {
    const draft = autoContentToDraft({ interactive: BUTTONS })
    expect(draft.mode).toBe('interactive')
    expect(draft.interactive.buttons).toEqual(['حجز', 'استفسار'])
    expect(buildAutoContent(draft)).toEqual({ interactive: BUTTONS })
  })

  it('reads a list and a link back into drafts the builder accepts', () => {
    const list: InboxInteractive = { type: 'list', body: 'الفروع', header: null, footer: null, button: 'الفروع', sections: [{ title: null, rows: [{ id: 'row_1', title: 'الملقا', description: 'صباحًا' }] }] }
    expect(buildInteractive(interactiveToDraft(list))).toEqual(list)
    const link: InboxInteractive = { type: 'cta_url', body: 'التعليمات', header: null, footer: null, display_text: 'افتح', url: 'https://example.test/a' }
    expect(buildInteractive(interactiveToDraft(link))).toEqual(link)
    expect(buildAutoContent({ ...emptyAutoContentDraft(), mode: 'interactive', interactive: emptyInteractiveDraft() })).toBeNull()
  })
})

describe('channel automation draft', () => {
  const automation = {
    welcome: { enabled: true, idle_days: 0, content: { body: 'أهلًا' } },
    away: { enabled: false, repeat_hours: 12, content: null },
    csat: { enabled: false, question: 'كيف تقيّم خدمتنا؟', good: 'راضٍ', neutral: 'محايد', bad: 'غير راضٍ' },
  }

  it('gives the stored automation back unchanged', () => {
    expect(automationWrite(automationToDraft(automation))).toEqual(automation)
  })

  it('refuses an enabled message without content, and a survey without a label', () => {
    const draft = automationToDraft(automation)
    draft.away.enabled = true
    expect(automationWrite(draft)).toBeNull()
    draft.away.enabled = false
    draft.csat.bad = ''
    expect(automationWrite(draft)).toBeNull()
  })
})

describe('rule draft', () => {
  const rule: InboxRule = {
    id: 4, sequence: 10, channel: { id: 1, name: 'واتساب' }, flow: null, name: 'حجز', active: true, match_kind: 'contains', keywords: ['حجز'], option_id: null, hours: 'any', stop: true,
    reply: { body: 'تفضل' }, resolve: false, department: { id: 2, name: 'المبيعات' }, assignee: null, tags: [{ id: 1, name: 'حجز' }], priority: 'high',
  }

  it('turns a stored rule into the write body it came from', () => {
    expect(ruleWrite(ruleToDraft(rule))).toEqual({
      channel_id: 1, flow_id: null, name: 'حجز', active: true, match_kind: 'contains', keywords: ['حجز'], option_id: null, hours: 'any', stop: true,
      reply: { body: 'تفضل' }, resolve: false, department_id: 2, assignee_id: null, tag_ids: [1], priority: 'high',
    })
  })

  it('needs a keyword for a text match, an option id for an option match, and an action', () => {
    const draft = ruleToDraft(rule)
    draft.keywords = []
    expect(ruleWrite(draft)).toBeNull()
    draft.matchKind = 'option'
    expect(ruleWrite(draft)).toBeNull()
    draft.optionId = 'btn_1'
    expect(ruleWrite(draft)?.option_id).toBe('btn_1')
    const bare = { ...emptyRuleDraft(), name: 'x', matchKind: 'any' as const, replyEnabled: false }
    expect(ruleWrite(bare)).toBeNull()
    expect(ruleWrite({ ...bare, resolve: true })).not.toBeNull()
  })

  it('rejects a draft whose reply is switched on but cannot be built, and sends reply null only when it is off', () => {
    const draft = ruleToDraft(rule)
    draft.reply = emptyRuleDraft().reply
    expect(draft.replyEnabled).toBe(true)
    expect(ruleWrite(draft)).toBeNull()
    expect(ruleWrite({ ...draft, replyEnabled: false })).toMatchObject({ reply: null })
  })

  it('sends keywords only for a text match and an option id only for an option match', () => {
    const draft = { ...ruleToDraft(rule), matchKind: 'any' as const, optionId: 'btn_1' }
    expect(ruleWriteCandidate(draft)).toMatchObject({ keywords: [], option_id: null })
    expect(ruleWrite(draft)).not.toBeNull()
  })

  it('sends a form id only for a form match and reads it back from a stored rule', () => {
    const draft = { ...ruleToDraft({ ...rule, match_kind: 'flow', keywords: [], flow: { id: 6, name: 'طلب موعد' } }) }
    expect(draft.flowId).toBe(6)
    expect(ruleWrite(draft)).toMatchObject({ match_kind: 'flow', flow_id: 6, keywords: [], option_id: null })
    expect(ruleWrite({ ...draft, flowId: null })).toBeNull()
    expect(ruleWriteCandidate({ ...draft, matchKind: 'any' })).toMatchObject({ flow_id: null })
  })

  it('lists the actions of a rule and moves one step inside the list only', () => {
    expect(ruleActionKeys(rule)).toEqual(['reply', 'department', 'tags', 'priority'])
    expect(moveRuleId([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
    expect(moveRuleId([1, 2, 3], 3, 1)).toEqual([1, 2, 3])
    expect(moveRuleId([1, 2, 3], 1, -1)).toEqual([1, 2, 3])
  })
})
