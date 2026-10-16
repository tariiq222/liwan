import type { QueryClient } from '@tanstack/vue-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectCreateDefaultsSchema, ProjectSettingsSchema, type ProjectSettings } from '@webvue/contracts'

export const projectSettingsKeys = {
  all: ['project-settings'] as const,
  createDefaults: ['project-settings', 'create-defaults'] as const,
}

export function useProjectSettings() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectSettingsKeys.all,
    queryFn: () => $api('/api/v1/settings/projects', { schema: ProjectSettingsSchema }),
  })
}

export function useProjectCreateDefaults() {
  const { $api } = useApi()
  return useQuery({
    queryKey: projectSettingsKeys.createDefaults,
    queryFn: () => $api('/api/v1/settings/projects/create-defaults', { schema: ProjectCreateDefaultsSchema }),
  })
}

// The saved settings are the server's answer, so they replace the cache
// outright. Create defaults are derived from them by the server and are only
// marked stale, so /projects/new asks again rather than trusting a local guess.
export function invalidateProjectSettingsCaches(qc: QueryClient, settings: ProjectSettings) {
  qc.setQueryData(projectSettingsKeys.all, settings)
  qc.invalidateQueries({ queryKey: projectSettingsKeys.createDefaults })
}

export function useUpdateProjectSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (patch: Partial<ProjectSettings>) => $api('/api/v1/settings/projects', { method: 'PATCH', body: patch, schema: ProjectSettingsSchema }),
    onSuccess: settings => invalidateProjectSettingsCaches(qc, settings),
  })
}
