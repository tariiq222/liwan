// Change request cache keys and route-filter parsers, kept beside `projectKeys` so composables never
// import from `components/`. Tone maps stay in `components/pmo/projects/changes/state.ts`.
import { PROJECT_CHANGE_STATES, type ProjectChangeState } from '@liwan/contracts'
import { projectKeys } from './projectKeys'

export type ChangeListFilters = { state?: ProjectChangeState; category_id?: number; limit?: number; offset?: number }

export const CHANGE_PAGE = 50

export function changeFilters(query: Record<string, unknown>): ChangeListFilters {
  const state = PROJECT_CHANGE_STATES.find(value => value === query.state)
  const category = typeof query.category_id === 'string' && /^[1-9]\d*$/.test(query.category_id) ? Number(query.category_id) : undefined
  const offset = typeof query.offset === 'string' && /^\d+$/.test(query.offset) ? Number(query.offset) : 0
  return { state, category_id: category, limit: CHANGE_PAGE, offset: Number.isSafeInteger(offset) ? offset : 0 }
}

const prefix = (projectId: number) => [...projectKeys.detail(projectId), 'changes'] as const
export const changeKeys = {
  all: prefix,
  list: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'list', params] as const,
  item: (projectId: number, id: number) => [...prefix(projectId), 'item', id] as const,
  categories: ['pmo', 'change-categories'] as const,
}
