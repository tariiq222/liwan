import { useQuery } from '@tanstack/vue-query'
import { ProjectRefSchema } from '@nasq/contracts'

const ProjectListSchema = ProjectRefSchema.array()

export function useProjects() {
  const { $api } = useApi()
  return useQuery({
    queryKey: ['projects', 'minimal'] as const,
    queryFn: () => $api('/api/v1/projects', { query: { minimal: 1 }, schema: ProjectListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}
