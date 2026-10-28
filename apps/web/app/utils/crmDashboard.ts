import type { CrmDashboard } from '@webvue/contracts'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import { CRM_LIST_PATH, formatPrice } from './crmOpportunity'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** The agent's four figures. "Due now" opens the due list; the money value has no link. */
export function agentKpiTiles(agent: CrmDashboard['agent'], t: Translate): KpiTile[] {
  return [
    { id: 'dueNow', label: t('crm.dashboard.agent.dueNow'), icon: 'i-lucide-phone-call', tone: agent.due_now ? 'warning' : 'neutral', value: agent.due_now, to: `${CRM_LIST_PATH}?due=1` },
    { id: 'newToday', label: t('crm.dashboard.agent.newToday'), icon: 'i-lucide-user-plus', tone: 'neutral', value: agent.new_today },
    { id: 'wonCount', label: t('crm.dashboard.agent.wonCount'), icon: 'i-lucide-circle-check', tone: 'success', value: agent.won_this_month.count },
    { id: 'wonValue', label: t('crm.dashboard.agent.wonValue'), icon: 'i-lucide-banknote', tone: 'success', value: formatPrice(agent.won_this_month.value) },
  ]
}

/** The manager's figures; each count opens the list it counts. */
export function managerKpiTiles(manager: NonNullable<CrmDashboard['manager']>, t: Translate): KpiTile[] {
  return [
    { id: 'unassigned', label: t('crm.dashboard.manager.unassigned'), icon: 'i-lucide-user-x', tone: manager.unassigned ? 'warning' : 'neutral', value: manager.unassigned, to: `${CRM_LIST_PATH}?unassigned=1` },
    { id: 'needsManager', label: t('crm.dashboard.manager.needsManager'), icon: 'i-lucide-flag', tone: manager.needs_manager ? 'danger' : 'neutral', value: manager.needs_manager, to: `${CRM_LIST_PATH}?needs_manager=1` },
    { id: 'dueFollowUps', label: t('crm.dashboard.manager.dueFollowUps'), icon: 'i-lucide-phone-forwarded', tone: manager.due_follow_ups ? 'warning' : 'neutral', value: manager.due_follow_ups, to: `${CRM_LIST_PATH}?due=1` },
    { id: 'won', label: t('crm.dashboard.manager.won'), icon: 'i-lucide-circle-check', tone: 'success', value: manager.won_this_month.count, hint: t('crm.dashboard.manager.wonHint', { value: formatPrice(manager.won_this_month.value) }) },
  ]
}

/** Won over total as a whole percent, 0 for a source with no records. */
export const conversionPercent = (won: number, total: number) => (total > 0 ? Math.round((won / total) * 100) : 0)
