import type { Cadence } from '@nasq/commercial-contracts'

const DAY_MS = 86_400_000

/** The price lines a subscription revision was sold with (`pricing` of the revision snapshot). */
export interface PricingBaseline { base_minor: number, bundle_minor: Record<string, number>, paid_extra_branches: number, branch_unit_minor: number }

/** One applied order: from `applied_at` on, its revision is what the subscription is billed for. */
export interface AppliedOrder {
  subscription_id: string, applied_at: number, plan_id: string, plan_name: string
  mrr_minor: number, branch_mrr_minor: number, cycle_minor: number
}

export type Timelines = Map<string, AppliedOrder[]>

export const monthsOf = (cadence: Cadence): number => (cadence.unit === 'year' ? 12 * cadence.count : cadence.count)

/** Recurring revenue of one revision, before tax and before any discount line (discounts are not part of the stored baseline). */
export function recurringOf(pricing: PricingBaseline, cadence: Cadence) {
  const months = monthsOf(cadence)
  const branchCycle = pricing.paid_extra_branches * pricing.branch_unit_minor
  const cycle = pricing.base_minor + Object.values(pricing.bundle_minor).reduce((sum, minor) => sum + minor, 0) + branchCycle
  return { cycle_minor: Math.round(cycle), mrr_minor: Math.round(cycle / months), branch_mrr_minor: Math.round(branchCycle / months) }
}

export function toTimelines(orders: readonly AppliedOrder[]): Timelines {
  const timelines: Timelines = new Map()
  for (const order of [...orders].sort((a, b) => a.applied_at - b.applied_at)) {
    const list = timelines.get(order.subscription_id)
    if (list) list.push(order)
    else timelines.set(order.subscription_id, [order])
  }
  return timelines
}

/** The order whose revision is in force just before `at` (exclusive upper bound, epoch ms). */
export function inForceAt(timeline: readonly AppliedOrder[], at: number): AppliedOrder | null {
  let found: AppliedOrder | null = null
  for (const order of timeline) {
    if (order.applied_at >= at) break
    found = order
  }
  return found
}

export interface BookAt { mrr_minor: number, branch_mrr_minor: number, customers: number, plans: Map<string, { name: string, customers: number, mrr_minor: number }> }

export function bookAt(timelines: Timelines, at: number): BookAt {
  const book: BookAt = { mrr_minor: 0, branch_mrr_minor: 0, customers: 0, plans: new Map() }
  for (const timeline of timelines.values()) {
    const order = inForceAt(timeline, at)
    if (!order) continue
    book.mrr_minor += order.mrr_minor
    book.branch_mrr_minor += order.branch_mrr_minor
    book.customers += 1
    const plan = book.plans.get(order.plan_id) ?? { name: order.plan_name, customers: 0, mrr_minor: 0 }
    plan.customers += 1
    plan.mrr_minor += order.mrr_minor
    book.plans.set(order.plan_id, plan)
  }
  return book
}

export interface PlanChange { from_plan: string, to_plan: string, direction: 'upgrade' | 'downgrade' | 'lateral', count: number }
export interface Movement { new_minor: number, expansion_minor: number, contraction_minor: number, new_customers: number, plan_changes: PlanChange[] }

/** What the orders applied in [from, to) did to recurring revenue. */
export function movementIn(timelines: Timelines, from: number, to: number): Movement {
  const movement: Movement = { new_minor: 0, expansion_minor: 0, contraction_minor: 0, new_customers: 0, plan_changes: [] }
  const changes = new Map<string, PlanChange>()
  for (const timeline of timelines.values()) {
    timeline.forEach((order, index) => {
      if (order.applied_at < from || order.applied_at >= to) return
      const previous = timeline[index - 1]
      if (!previous) {
        movement.new_minor += order.mrr_minor
        movement.new_customers += 1
        return
      }
      const delta = order.mrr_minor - previous.mrr_minor
      if (delta > 0) movement.expansion_minor += delta
      else movement.contraction_minor -= delta
      if (previous.plan_id === order.plan_id) return
      const direction = delta > 0 ? 'upgrade' : delta < 0 ? 'downgrade' : 'lateral'
      const key = `${previous.plan_id}>${order.plan_id}>${direction}`
      const change = changes.get(key) ?? { from_plan: previous.plan_name, to_plan: order.plan_name, direction, count: 0 }
      change.count += 1
      changes.set(key, change)
    })
  }
  movement.plan_changes = [...changes.values()].sort((a, b) => b.count - a.count)
  return movement
}

export interface Period { from: string, to: string }

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** First instant of `period.from` and the first instant after `period.to` (UTC), epoch ms. */
export const periodBounds = (period: Period) => ({ start: Date.parse(period.from), end: Date.parse(period.to) + DAY_MS })

/** The period of equal length that ends the day before `period` starts. */
export function previousPeriod(period: Period): Period {
  const { start, end } = periodBounds(period)
  return { from: isoDay(start - (end - start)), to: isoDay(start - DAY_MS) }
}

/** The `count` calendar months ending with the month of `anchor`: first instant of the month after each (exclusive bound) and its label. */
export function monthEnds(anchor: string, count: number): { month: string, end: number }[] {
  const base = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => {
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - (count - 1 - i) + 1, 1))
    const label = new Date(next.getTime() - DAY_MS).toISOString().slice(0, 7)
    return { month: label, end: next.getTime() }
  })
}

export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)

export const DAY = DAY_MS
