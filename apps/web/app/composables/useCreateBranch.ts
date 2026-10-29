import { useMutation } from '@tanstack/vue-query'
import { BranchCreateInputSchema, BranchCreatedSchema, type BranchCreateInput } from '@webvue/contracts'
import { branchMutationRefresh } from './useBranchAccess'

export function useCreateBranch() {
  const { $api } = useApi()
  const refresh = branchMutationRefresh()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: BranchCreateInput) => $api('/api/v1/admin/branches', { method: 'POST', body: BranchCreateInputSchema.parse(body), schema: BranchCreatedSchema }),
    onSuccess: refresh,
  })
}
