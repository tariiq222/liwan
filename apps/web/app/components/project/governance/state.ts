import type { ProjectRaciRole, ProjectRegisterKind, ProjectRegisterStatus, ProjectRegisterPriority } from '../../../../../../packages/contracts/src/pmo/governance'
import type { StateTone } from '@/composables/taskState'
export type GovernanceRegisterFilters = { q?: string; kind?: ProjectRegisterKind; status?: ProjectRegisterStatus; priority?: ProjectRegisterPriority; limit?: number; offset?: number }
export function governanceFilters(query: Record<string, unknown>): GovernanceRegisterFilters {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]) => typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined
  const offset = typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : 0
  return { q: typeof query.q === 'string' ? query.q.trim() || undefined : undefined, kind: pick(query.kind, ['risk', 'issue']), status: pick(query.status, ['open', 'in_progress', 'resolved', 'closed']), priority: pick(query.priority, ['low', 'normal', 'high', 'critical']), limit: 50, offset: Number.isSafeInteger(offset) ? offset : 0 }
}
const prefix = (id: number) => ['project', id, 'governance'] as const
export const governanceKeys = {
  all: prefix,
  stakeholders: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'stakeholders', params] as const,
  stakeholder: (projectId: number, id: number) => [...prefix(projectId), 'stakeholder', id] as const,
  raci: (projectId: number, params: Record<string, unknown> = {}) => [...prefix(projectId), 'raci', params] as const,
  register: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'register', params] as const,
  registerItem: (projectId: number, id: number) => [...prefix(projectId), 'register-item', id] as const,
}

export const REGISTER_PRIORITY_TONE: Record<ProjectRegisterPriority, StateTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  critical: 'destructive',
}
export const REGISTER_STATUS_TONE: Record<ProjectRegisterStatus, StateTone> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
}
export const RACI_ROLE_TONE: Record<ProjectRaciRole, StateTone> = {
  R: 'info',
  A: 'warning',
  C: 'success',
  I: 'neutral',
}
export function registerScoreTone(score: number | null | undefined): StateTone {
  if (score == null) return 'neutral'
  if (score >= 16) return 'destructive'
  if (score >= 9) return 'warning'
  return 'info'
}

export function governanceMatrixFilters(query: Record<string, unknown>) {
  const page = (value: unknown) => {
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0
    return Number.isSafeInteger(number) && number <= Math.floor(Number.MAX_SAFE_INTEGER / 50) ? number : 0
  }
  return { taskQ: typeof query.task_q === 'string' ? query.task_q : '', stakeholderQ: typeof query.stakeholder_q === 'string' ? query.stakeholder_q : '', closed: query.closed === '1', taskPage: page(query.task_page), stakeholderPage: page(query.stakeholder_page) }
}
