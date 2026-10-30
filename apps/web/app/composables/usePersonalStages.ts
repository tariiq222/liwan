import { useQuery } from '@tanstack/vue-query'
import { PersonalStageSchema } from '@liwan/contracts'
import { taskKeys } from './useTasks'

const PersonalStageListSchema = PersonalStageSchema.array()

// Personal stages rarely change within a session, so keep them fresh for
// 5 minutes rather than refetching on every mount.
export function usePersonalStages() {
  const { $api } = useApi()
  return useQuery({
    queryKey: taskKeys.stages,
    queryFn: () => $api('/api/v1/me/personal-stages', { schema: PersonalStageListSchema }),
    staleTime: 5 * 60 * 1000,
  })
}
