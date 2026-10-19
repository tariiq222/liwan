import type { RouteLocationRaw } from 'vue-router'
import { STATUS_COLOR, type StatusTone } from './statusTone'

/** One tag after the page title: a subtle badge, or a link when it carries `to`. `testId` names the badge for e2e. */
export interface PageHeaderTag { label: string; tone?: 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error'; icon?: string; to?: RouteLocationRaw; testId?: string }

/** A status badge's props (tone and translated label) as a header tag, so a state moves into the heading unchanged. */
export function statusTag(badge: { tone: StatusTone; label: string }, testId?: string): PageHeaderTag {
  return { label: badge.label, tone: STATUS_COLOR[badge.tone], testId }
}
