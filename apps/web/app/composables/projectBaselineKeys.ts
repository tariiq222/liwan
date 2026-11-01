// Baseline cache keys, kept beside `projectKeys` so composables never import from `components/`.
import { projectKeys } from './projectKeys'

export const BASELINE_PAGE = 50

const prefix = (projectId: number) => [...projectKeys.detail(projectId), 'baselines'] as const
export const baselineKeys = {
  all: prefix,
  list: (projectId: number, params: Record<string, unknown>) => [...prefix(projectId), 'list', params] as const,
  item: (projectId: number, number: number) => [...prefix(projectId), 'item', number] as const,
  variance: (projectId: number) => [...prefix(projectId), 'variance'] as const,
}
