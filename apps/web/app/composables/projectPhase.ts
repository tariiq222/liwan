import { PROJECT_PHASES, type ProjectPhase, type ProjectPhaseGateCheck, type ProjectPhaseState } from '@webvue/contracts'

// Pure project-phase helpers (no Nuxt imports) — see __tests__/projectPhase.test.ts.
export const PHASE_LABEL_KEY: Record<ProjectPhase, string> = {
  initiating: 'projects.phase.steps.initiating',
  planning: 'projects.phase.steps.planning',
  executing: 'projects.phase.steps.executing',
  closing: 'projects.phase.steps.closing',
  closed: 'projects.phase.steps.closed',
}
export const PHASE_COUNT = PROJECT_PHASES.length

export type PhaseStepState = 'done' | 'current' | 'upcoming'

/** The five steps in lifecycle order, each marked relative to the current phase. */
export function phaseSteps(current: ProjectPhase): { phase: ProjectPhase; state: PhaseStepState }[] {
  const index = PROJECT_PHASES.indexOf(current)
  return PROJECT_PHASES.map((phase, i) => ({ phase, state: i < index ? 'done' : i === index ? 'current' : 'upcoming' }))
}

/** 1-based position of the phase, for the compact "n/5" reading. */
export const phaseNumber = (phase: ProjectPhase): number => PROJECT_PHASES.indexOf(phase) + 1

// The gate keys the server can report; an unknown key renders the generic label and no fix link.
const GATE_CHECKS: Record<string, { labelKey: string; fixPath: (projectId: number) => string }> = {
  charter_approved: { labelKey: 'projects.phase.checks.charter_approved', fixPath: id => `/projects/${id}/charter` },
  no_open_tasks: { labelKey: 'projects.phase.checks.no_open_tasks', fixPath: id => `/projects/${id}/tasks` },
}
export const UNKNOWN_CHECK_KEY = 'projects.phase.checks.unknown'

export interface GateCheckRow { key: string; ok: boolean; labelKey: string; fixTo: string | null }

export function gateCheckRows(projectId: number, checks: readonly ProjectPhaseGateCheck[]): GateCheckRow[] {
  return checks.map(({ key, ok }) => {
    const known = GATE_CHECKS[key]
    return { key, ok, labelKey: known?.labelKey ?? UNKNOWN_CHECK_KEY, fixTo: known ? known.fixPath(projectId) : null }
  })
}

/** The move button is live only for a manager, with a next phase and every blocking check met; a `warning` check never blocks. */
export const canMoveForward = (state: ProjectPhaseState, canManage: boolean): boolean =>
  canManage && state.next !== null && state.next_checks.every(check => check.ok || check.warning)

/** The unmet checks that only warn: the manager must confirm them before the move. */
export const unmetWarnings = (checks: readonly ProjectPhaseGateCheck[]): ProjectPhaseGateCheck[] =>
  checks.filter(check => !check.ok && check.warning)

/** A refused move whose every unmet check is a warning: confirming and resending with `acknowledge_warnings` can succeed. */
export function isWarningGate(error: unknown): boolean {
  const { status, code, details } = (typeof error === 'object' && error !== null ? error : {}) as { status?: number; code?: string; details?: { checks?: ProjectPhaseGateCheck[] } }
  if (status !== 409 || code !== 'phase_gate' || !Array.isArray(details?.checks)) return false
  const unmet = details.checks.filter(check => !check.ok)
  return unmet.length > 0 && unmet.every(check => check.warning)
}

/** The gate card shows for a manager, a closed project or any check; a reader would otherwise see a bare heading. An archived project is read-only, so it has no gate at all. */
export const isGateCardVisible = (state: ProjectPhaseState, canManage: boolean, active = true): boolean =>
  active && (canManage || state.current === 'closed' || state.next_checks.length > 0)

/** The gate card is the page's one call to action while it is shown on an open project; a closed project's gate is a quiet note. */
export const isGateAction = (state: ProjectPhaseState, canManage: boolean, active = true): boolean =>
  state.current !== 'closed' && isGateCardVisible(state, canManage, active)

/** What a failed phase move tells the user: a locale key and toast colour; server text is never shown. */
export function phaseFailure(error: unknown): { key: string; color: 'warning' | 'error' } {
  const { status, code } = (typeof error === 'object' && error !== null ? error : {}) as { status?: number; code?: string }
  if (status === 409 && code === 'stale_write') return { key: 'projects.phase.stale', color: 'warning' }
  if (code === 'phase_gate') return { key: 'projects.phase.errors.gate', color: 'error' }
  if (code === 'phase_step') return { key: 'projects.phase.errors.step', color: 'error' }
  if (status === 403) return { key: 'projects.phase.errors.forbidden', color: 'error' }
  return { key: 'errors.generic', color: 'error' }
}
