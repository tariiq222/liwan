import { ProjectRefSchema } from '@webvue/contracts'
import { projectKeys } from '../../composables/projectKeys'
import { fetchAllRecordOptions } from '../fetchAllRecordOptions'
import type { AppRecordPicker } from '../types'

export const PROJECT_REF_PAGE = 200

/** Projects other applications attach records to or filter by: minimal `{id, name}` refs. */
export const projectPicker: AppRecordPicker = {
  kind: 'project',
  capability: 'pmo.projects.read',
  taskCapability: 'pmo.tasks.create',
  queryKey: projectKeys.minimal,
  options: (api, signal) => fetchAllRecordOptions(
    offset => api('/api/v1/projects', { query: { minimal: 1, limit: PROJECT_REF_PAGE, offset }, schema: ProjectRefSchema.array() }),
    PROJECT_REF_PAGE,
    signal,
  ),
}
