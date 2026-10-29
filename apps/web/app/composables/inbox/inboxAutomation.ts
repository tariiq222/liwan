import {
  InboxAutoContentSchema, InboxChannelAutomationSchema, InboxRuleWriteSchema, InboxWorkingHoursSchema,
  type InboxAutoContent, type InboxChannelAutomation, type InboxPriority, type InboxRule, type InboxRuleMatchKind, type InboxRuleWrite, type InboxWorkingHours,
} from '@webvue/contracts'
import { buildCommerceContent, commerceToDraft, emptyCommerceDraft, type CommerceDraft } from './inboxCommerce'
import { buildInteractive, emptyInteractiveDraft, interactiveToDraft, type InteractiveDraft } from './inboxInteractive'

// Pure helpers of the inbox automation screens: the weekly hours grid, the text-or-interactive content of an
// automatic message, and a rule form. Each editor works on a draft; the contract schemas decide what may be saved.

// ---------------------------------------------------------------- working hours

/** Odoo's weekday numbers (0 = Monday ... 6 = Sunday), in the order the week is shown: Sunday first. */
export const WEEK_ORDER: readonly number[] = [6, 0, 1, 2, 3, 4, 5]
export const DEFAULT_TIMEZONE = 'Asia/Riyadh'
export const DEFAULT_RANGE = { from: '09:00', to: '17:00' } as const
const TIMEZONES = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Asia/Baghdad', 'Asia/Amman',
  'Africa/Cairo', 'Europe/Istanbul', 'Europe/London', 'UTC',
] as const

export interface HoursRangeDraft { from: string; to: string }
export interface HolidayDraft { name: string; date_from: string; date_to: string }
export interface HoursDraft {
  timezone: string
  /** Index = weekday; each day holds its ranges (none = closed). */
  week: HoursRangeDraft[][]
  holidays: HolidayDraft[]
}

export const emptyHoursDraft = (): HoursDraft => ({ timezone: DEFAULT_TIMEZONE, week: Array.from({ length: 7 }, () => []), holidays: [] })

export function hoursToDraft(hours: InboxWorkingHours): HoursDraft {
  const draft = emptyHoursDraft()
  draft.timezone = hours.timezone
  for (const range of hours.days) draft.week[range.weekday]!.push({ from: range.from, to: range.to })
  for (const day of draft.week) day.sort((a, b) => a.from.localeCompare(b.from))
  draft.holidays = hours.holidays.map(holiday => ({ ...holiday }))
  return draft
}

export function draftToHours(draft: HoursDraft): InboxWorkingHours {
  return {
    timezone: draft.timezone,
    days: draft.week.flatMap((ranges, weekday) => ranges.map(range => ({ weekday, from: range.from, to: range.to }))),
    holidays: draft.holidays.map(holiday => ({ name: holiday.name.trim(), date_from: holiday.date_from, date_to: holiday.date_to })),
  }
}

/** The weekdays whose ranges overlap each other (the contract checks one range at a time, not a day). */
export function overlappingWeekdays(draft: HoursDraft): number[] {
  return draft.week.flatMap((ranges, weekday) => {
    const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from))
    return sorted.some((range, index) => index > 0 && range.from < sorted[index - 1]!.to) ? [weekday] : []
  })
}

export const hoursValid = (draft: HoursDraft) => InboxWorkingHoursSchema.safeParse(draftToHours(draft)).success && !overlappingWeekdays(draft).length

/** Timezones offered in the select; the saved one is kept even when it is not in the short list. */
export function timezoneChoices(current: string): string[] {
  return TIMEZONES.includes(current as typeof TIMEZONES[number]) ? [...TIMEZONES] : [current, ...TIMEZONES]
}

// ---------------------------------------------------------------- automatic message content

export type AutoContentMode = 'text' | 'interactive' | 'commerce'
export interface AutoContentDraft { mode: AutoContentMode; body: string; interactive: InteractiveDraft; commerce: CommerceDraft }

export const emptyAutoContentDraft = (): AutoContentDraft => ({ mode: 'text', body: '', interactive: emptyInteractiveDraft(), commerce: emptyCommerceDraft() })

export function autoContentToDraft(content: InboxAutoContent | null): AutoContentDraft {
  const draft = emptyAutoContentDraft()
  if (!content) return draft
  if ('interactive' in content) return { ...draft, mode: 'interactive', interactive: interactiveToDraft(content.interactive) }
  if ('commerce' in content) return { ...draft, mode: 'commerce', commerce: commerceToDraft(content.commerce) }
  return { ...draft, body: content.body }
}

/** The content the server stores, or null while the draft is empty or breaks a limit. */
export function buildAutoContent(draft: AutoContentDraft): InboxAutoContent | null {
  const candidate = draft.mode === 'text' ? { body: draft.body.trim() } : draft.mode === 'interactive' ? { interactive: buildInteractive(draft.interactive) } : { commerce: buildCommerceContent(draft.commerce) }
  const parsed = InboxAutoContentSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------- rules

type InboxRuleHours = InboxRule['hours']
export const RULE_MATCH_KINDS: readonly InboxRuleMatchKind[] = ['any', 'contains', 'exact', 'starts_with', 'option', 'flow', 'order']
export const RULE_HOURS: readonly InboxRuleHours[] = ['any', 'inside', 'outside']
export const TEXT_MATCH_KINDS: readonly InboxRuleMatchKind[] = ['contains', 'exact', 'starts_with']

export interface RuleDraft {
  name: string
  active: boolean
  channelId: number | null
  matchKind: InboxRuleMatchKind
  keywords: string[]
  optionId: string
  /** The form whose submission triggers the rule, for the `flow` match. */
  flowId: number | null
  hours: InboxRuleHours
  stop: boolean
  replyEnabled: boolean
  reply: AutoContentDraft
  departmentId: number | null
  assigneeId: number | null
  tagIds: number[]
  priority: InboxPriority | null
  resolve: boolean
}

export const emptyRuleDraft = (): RuleDraft => ({
  name: '', active: true, channelId: null, matchKind: 'contains', keywords: [], optionId: '', flowId: null, hours: 'any', stop: true,
  replyEnabled: true, reply: emptyAutoContentDraft(), departmentId: null, assigneeId: null, tagIds: [], priority: null, resolve: false,
})

export function ruleToDraft(rule: InboxRule): RuleDraft {
  return {
    name: rule.name, active: rule.active, channelId: rule.channel?.id ?? null, matchKind: rule.match_kind, keywords: [...rule.keywords],
    optionId: rule.option_id ?? '', flowId: rule.flow?.id ?? null, hours: rule.hours, stop: rule.stop, replyEnabled: rule.reply !== null, reply: autoContentToDraft(rule.reply),
    departmentId: rule.department?.id ?? null, assigneeId: rule.assignee?.id ?? null, tagIds: rule.tags.map(tag => tag.id), priority: rule.priority, resolve: rule.resolve,
  }
}

/** The write body for a draft: keywords only for a text match, the option id only for an option match. */
export function ruleWriteCandidate(draft: RuleDraft): Record<keyof InboxRuleWrite, unknown> {
  const text = TEXT_MATCH_KINDS.includes(draft.matchKind)
  return {
    name: draft.name.trim(), active: draft.active, channel_id: draft.channelId, match_kind: draft.matchKind,
    keywords: text ? draft.keywords.map(word => word.trim()).filter(Boolean) : [],
    option_id: draft.matchKind === 'option' ? draft.optionId.trim() || null : null,
    flow_id: draft.matchKind === 'flow' ? draft.flowId : null,
    hours: draft.hours, stop: draft.stop,
    reply: draft.replyEnabled ? buildAutoContent(draft.reply) : null,
    resolve: draft.resolve, department_id: draft.departmentId, assignee_id: draft.assigneeId, tag_ids: draft.tagIds, priority: draft.priority,
  }
}

/** The write body, or null while the draft is incomplete; a reply that is switched on but cannot be built is never sent as "no reply". */
export function ruleWrite(draft: RuleDraft): InboxRuleWrite | null {
  const candidate = ruleWriteCandidate(draft)
  if (draft.replyEnabled && candidate.reply === null) return null
  const parsed = InboxRuleWriteSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** What a rule does, as the locale keys of its actions, for the list rows. */
export function ruleActionKeys(rule: InboxRule): string[] {
  return [
    ...(rule.reply ? ['reply'] : []),
    ...(rule.department ? ['department'] : []),
    ...(rule.assignee ? ['assignee'] : []),
    ...(rule.tags.length ? ['tags'] : []),
    ...(rule.priority ? ['priority'] : []),
    ...(rule.resolve ? ['resolve'] : []),
  ]
}

/** The order after moving one rule a step; the same list when it is already at that end. */
export function moveRuleId(ids: readonly number[], id: number, step: -1 | 1): number[] {
  const from = ids.indexOf(id)
  const to = from + step
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}

// ---------------------------------------------------------------- channel automatic messages

export interface ChannelAutomationDraft {
  welcome: { enabled: boolean; idleDays: number; content: AutoContentDraft }
  away: { enabled: boolean; repeatHours: number; content: AutoContentDraft }
  csat: { enabled: boolean; question: string; good: string; neutral: string; bad: string }
}

export function automationToDraft(automation: InboxChannelAutomation): ChannelAutomationDraft {
  return {
    welcome: { enabled: automation.welcome.enabled, idleDays: automation.welcome.idle_days, content: autoContentToDraft(automation.welcome.content) },
    away: { enabled: automation.away.enabled, repeatHours: automation.away.repeat_hours, content: autoContentToDraft(automation.away.content) },
    csat: { ...automation.csat },
  }
}

/** The body the server stores; a disabled message with an unfinished draft is saved without content. */
export function automationCandidate(draft: ChannelAutomationDraft) {
  return {
    welcome: { enabled: draft.welcome.enabled, idle_days: draft.welcome.idleDays, content: buildAutoContent(draft.welcome.content) },
    away: { enabled: draft.away.enabled, repeat_hours: draft.away.repeatHours, content: buildAutoContent(draft.away.content) },
    csat: { enabled: draft.csat.enabled, question: draft.csat.question.trim(), good: draft.csat.good.trim(), neutral: draft.csat.neutral.trim(), bad: draft.csat.bad.trim() },
  }
}

export function automationWrite(draft: ChannelAutomationDraft): InboxChannelAutomation | null {
  const parsed = InboxChannelAutomationSchema.safeParse(automationCandidate(draft))
  return parsed.success ? parsed.data : null
}
