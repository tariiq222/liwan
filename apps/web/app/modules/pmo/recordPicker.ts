import { ProjectRefSchema } from '@webvue/contracts'
import { projectKeys } from '../../composables/projectKeys'
import type { AppRecordOption, AppRecordPicker } from '../types'

export const PROJECT_REF_PAGE = 200

/** Walks server pages until a short page, so callers receive a single array. */
export async function fetchAllProjectRefs(
  requestPage: (offset: number) => Promise<AppRecordOption[]>,
  pageSize = PROJECT_REF_PAGE,
  signal?: AbortSignal,
): Promise<AppRecordOption[]> {
  const items: AppRecordOption[] = []
  let offset = 0
  while (true) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    const page = await requestPage(offset)
    items.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }
  return items
}

/** Projects other applications attach records to or filter by: minimal `{id, name}` refs. */
export const projectPicker: AppRecordPicker = {
  kind: 'project',
  capability: 'pmo.projects.read',
  taskCapability: 'pmo.tasks.create',
  queryKey: projectKeys.minimal,
  options: (api, signal) => fetchAllProjectRefs(
    offset => api('/api/v1/projects', { query: { minimal: 1, limit: PROJECT_REF_PAGE, offset }, schema: ProjectRefSchema.array() }),
    PROJECT_REF_PAGE,
    signal,
  ),
}
