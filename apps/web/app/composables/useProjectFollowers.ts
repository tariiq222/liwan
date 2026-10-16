import type { Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { UserRefSchema } from '@webvue/contracts'
import { projectKeys } from './projectKeys'

const FollowerListSchema = UserRefSchema.array()

export function useFollowers(projectId: Ref<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => projectKeys.followers(projectId.value ?? 0)),
    enabled: computed(() => !!projectId.value),
    queryFn: () => $api(`/api/v1/projects/${projectId.value}/followers`, { schema: FollowerListSchema }),
  })
}

export function useAddFollower() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: number; userId: number }) =>
      $api(`/api/v1/projects/${projectId}/followers`, { method: 'POST', body: { user_id: userId }, schema: FollowerListSchema }),
    onSuccess: (followers, { projectId }) => {
      qc.setQueryData(projectKeys.followers(projectId), followers)
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}

export function useRemoveFollower() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: number; userId: number }) =>
      $api(`/api/v1/projects/${projectId}/followers/${userId}`, { method: 'DELETE', schema: FollowerListSchema }),
    onSuccess: (followers, { projectId }) => {
      qc.setQueryData(projectKeys.followers(projectId), followers)
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}
