import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ProjectCreateDefaultsSchema, ProjectSettingsSchema, type ProjectSettings } from '@nasq/contracts'

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

export function useUpdateProjectSettings() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (patch: Partial<ProjectSettings>) => $api('/api/v1/settings/projects', { method: 'PATCH', body: patch, schema: ProjectSettingsSchema }),
    onSuccess: (settings) => {
      qc.setQueryData(projectSettingsKeys.all, settings)
      qc.invalidateQueries({ queryKey: projectSettingsKeys.createDefaults })
    },
  })
}
