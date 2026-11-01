import type { HrWarning, HrWarningState } from '@liwan/contracts'
import type { StatusBadgeEntry } from '@liwan/ui/app/utils/statusBadge'

const WARNING_STATE_TONE: Record<HrWarningState, StatusBadgeEntry['tone']> = {
  draft: 'neutral',
  issued: 'info',
  acknowledged: 'success',
  contested: 'warning',
  withdrawn: 'neutral',
}

/** A warning's state: draft and withdrawn neutral, issued info, acknowledged success, contested warning. */
export function hrWarningBadge(state: HrWarningState): StatusBadgeEntry {
  return { tone: WARNING_STATE_TONE[state], labelKey: `hrWarnings.state.${state}` }
}

/** The states in which a warning counts and HR may still withdraw it. */
const OPEN_STATES: readonly HrWarningState[] = ['issued', 'acknowledged', 'contested']

/** An issuer (the server's `can_issue`) issues a draft; nobody else does. */
export function canIssueHrWarning(warning: Pick<HrWarning, 'state'>, canIssue: boolean): boolean {
  return canIssue && warning.state === 'draft'
}

/** An issuer discards a draft; only HR withdraws an issued, acknowledged or contested warning. Both need a reason. */
export function canWithdrawHrWarning(warning: Pick<HrWarning, 'state'>, who: { canManage: boolean; canIssue: boolean }): boolean {
  return warning.state === 'draft' ? who.canIssue : who.canManage && OPEN_STATES.includes(warning.state)
}

/** What the employee may do with an own warning: nothing when the company switched answers off. */
export function ownHrWarningActions(warning: Pick<HrWarning, 'state' | 'acknowledgement'>): { acknowledge: boolean; contest: boolean } {
  const open = warning.state === 'issued' && warning.acknowledgement !== 'off'
  return { acknowledge: open, contest: open }
}

export interface HrWarningEvent {
  kind: 'issued' | 'acknowledged' | 'contested' | 'withdrawn'
  at: string
  by: string | null
}

/** Who did what and when, oldest first; only the steps the record carries a time for. */
export function hrWarningEvents(warning: HrWarning): HrWarningEvent[] {
  const events: HrWarningEvent[] = []
  if (warning.issued_at) events.push({ kind: 'issued', at: warning.issued_at, by: warning.issued_by?.name ?? null })
  if (warning.acknowledged_at) events.push({ kind: 'acknowledged', at: warning.acknowledged_at, by: warning.employee.name })
  if (warning.contested_at) events.push({ kind: 'contested', at: warning.contested_at, by: warning.employee.name })
  if (warning.withdrawn_at) events.push({ kind: 'withdrawn', at: warning.withdrawn_at, by: warning.withdrawn_by?.name ?? null })
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

/** A warning type with its severity rank, lowest rank first, equal ranks by name. */
export function sortHrWarningTypes<T extends { name: string; severity: number }>(types: readonly T[]): T[] {
  return [...types].sort((a, b) => a.severity - b.severity || a.name.localeCompare(b.name))
}
