// Governance cache keys and route-filter parsers, kept beside `projectKeys`
// so composables never import from `components/`. Tone maps stay in
// `components/pmo/projects/governance/state.ts` (presentation only).
import type { ProjectRegisterKind, ProjectRegisterStatus, ProjectRegisterPriority } from '@liwan/contracts'
import { projectKeys } from './projectKeys'

export type GovernanceRegisterFilters = { q?: string; kind?: ProjectRegisterKind; status?: ProjectRegisterStatus; priority?: ProjectRegisterPriority; limit?: number; offset?: number }

export function governanceFilters(query: Record<string, unknown>): GovernanceRegisterFilters {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]) => typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined
  const offset = typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : 0
  return { q: typeof query.q === 'string' ? query.q.trim() || undefined : undefined, kind: pick(query.kind, ['risk', 'issue']), status: pick(query.status, ['open', 'in_progress', 'resolved', 'closed']), priority: pick(query.priority, ['low', 'normal', 'high', 'critical']), limit: 50, offset: Number.isSafeInteger(offset) ? offset : 0 }
}

export function governanceMatrixFilters(query: Record<string, unknown>) {
  const page = (value: unknown) => {
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0
    return Number.isSafeInteger(number) && number <= Math.floor(Number.MAX_SAFE_INTEGER / 50) ? number : 0
  }
  return { taskQ: typeof query.task_q === 'string' ? query.task_q : '', stakeholderQ: typeof query.stakeholder_q === 'string' ? query.stakeholder_q : '', closed: query.closed === '1', taskPage: page(query.task_page), stakeholderPage: page(query.stakeholder_page) }
}

const prefix = (id: number) => [...projectKeys.detail(id), 'governance'] as const
export const governanceKeys = {
  all: prefix,
  stakeholders: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'stakeholders', params] as const,
  stakeholder: (projectId: number, id: number) => [...prefix(projectId), 'stakeholder', id] as const,
  raci: (projectId: number, params: Record<string, unknown> = {}) => [...prefix(projectId), 'raci', params] as const,
  register: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'register', params] as const,
  registerItem: (projectId: number, id: number) => [...prefix(projectId), 'register-item', id] as const,
}
