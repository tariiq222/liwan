import type { LocationQuery } from 'vue-router'
import { InboxCostQuerySchema, InboxReportQuerySchema, inboxReportRangeDays } from '@webvue/contracts'
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'

/** The quick periods of the report filters; `custom` carries its own `from` and `to`. */
export const REPORT_PERIODS = ['7', '30', '90'] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number] | 'custom'
export const DEFAULT_REPORT_PERIOD = '30'

/** The report filters. They live in the URL query, so a direct link, a refresh and Back keep them. */
export interface InboxReportRoute {
  period: ReportPeriod
  from: string
  to: string
  channelId: number | null
  departmentId: number | null
  agentId: number | null
}

export interface InboxReportRange { from: string; to: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function single(value: LocationQuery[string] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function positiveInt(value: string): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** The calendar day `days` before `day`, as YYYY-MM-DD (UTC arithmetic on a bare date never shifts it). */
export function shiftIsoDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The last `days` days ending today, both ends included. */
export function lastDaysRange(days: number, today: Date = new Date()): InboxReportRange {
  const to = localIsoDay(today)
  return { from: shiftIsoDay(to, -(days - 1)), to }
}

/**
 * Reads the filters from the query. A custom range that runs backwards or exceeds `maxDays` falls back to the default
 * period, so a hand-edited link never asks the server for something it refuses.
 */
export function parseInboxReportRoute(query: LocationQuery, maxDays = 366): InboxReportRoute {
  const channelId = positiveInt(single(query.channel_id))
  const departmentId = positiveInt(single(query.department_id))
  const agentId = positiveInt(single(query.agent_id))
  const from = single(query.from)
  const to = single(query.to)
  const days = ISO_DAY.test(from) && ISO_DAY.test(to) ? inboxReportRangeDays(from, to) : 0
  if (days >= 1 && days <= maxDays) return { period: 'custom', from, to, channelId, departmentId, agentId }
  const period = REPORT_PERIODS.find(value => value === single(query.period) && Number(value) <= maxDays) ?? DEFAULT_REPORT_PERIOD
  return { period, from: '', to: '', channelId, departmentId, agentId }
}

/** Only what differs from the defaults, so the URL of an unfiltered report stays clean. */
export function serializeInboxReportRoute(route: InboxReportRoute): Record<string, string> {
  return {
    ...(route.period === 'custom' ? { from: route.from, to: route.to } : route.period !== DEFAULT_REPORT_PERIOD ? { period: route.period } : {}),
    ...(route.channelId ? { channel_id: String(route.channelId) } : {}),
    ...(route.departmentId ? { department_id: String(route.departmentId) } : {}),
    ...(route.agentId ? { agent_id: String(route.agentId) } : {}),
  }
}

/** The days the route covers; a quick period ends today. */
export function reportRange(route: InboxReportRoute, today: Date = new Date()): InboxReportRange {
  return route.period === 'custom' ? { from: route.from, to: route.to } : lastDaysRange(Number(route.period), today)
}

/** The query of the overview route; null filters are left out. */
export function overviewQuery(route: InboxReportRoute, today?: Date) {
  const query = {
    ...reportRange(route, today),
    ...(route.channelId ? { channel_id: route.channelId } : {}),
    ...(route.departmentId ? { department_id: route.departmentId } : {}),
    ...(route.agentId ? { agent_id: route.agentId } : {}),
  }
  return InboxReportQuerySchema.parse(query)
}

/** The breakdown takes no agent filter (it is the agent dimension itself). */
export function breakdownQuery(route: InboxReportRoute, today?: Date) {
  const { agent_id: _agent, ...rest } = overviewQuery(route, today)
  return rest
}

export function costQuery(route: InboxReportRoute, today?: Date) {
  return InboxCostQuerySchema.parse({ ...reportRange(route, today), ...(route.channelId ? { channel_id: route.channelId } : {}) })
}
