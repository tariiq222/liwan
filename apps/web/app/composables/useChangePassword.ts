import { useMutation } from '@tanstack/vue-query'
import { MeSchema, type Me, type PasswordChange } from '@nasq/contracts'

export function useChangePassword() {
  const { $api } = useApi()
  const resetAfterSettlement: { reset: () => void } = { reset: () => {} }
  const mutation = useMutation<Me, unknown, PasswordChange>({
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
