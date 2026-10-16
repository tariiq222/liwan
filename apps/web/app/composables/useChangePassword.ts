import { useMutation } from '@tanstack/vue-query'
import { MeSchema, type Me, type PasswordChange } from '@webvue/contracts'

export const PASSWORD_MUTATION_GC_TIME = 0

export function useChangePassword() {
  const { $api } = useApi()
  const resetAfterSettlement: { reset: () => void } = { reset: () => {} }
  const mutation = useMutation<Me, unknown, PasswordChange>({
    gcTime: PASSWORD_MUTATION_GC_TIME,
    mutationFn: (payload) => $api('/api/v1/me/password', {
      method: 'POST',
      body: payload,
      schema: MeSchema,
    }),
    // Mutation variables contain credentials. Clear them from TanStack Query
    // as soon as the request settles instead of retaining them in its state.
    onSettled: () => resetAfterSettlement.reset(),
  })
  resetAfterSettlement.reset = mutation.reset
  return mutation
}
