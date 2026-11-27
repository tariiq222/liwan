import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { TelephonySettings } from '@liwan/contracts'
import { TelephonySettingsSchema } from '@liwan/contracts'

/**
 * The company's telephony settings (design section 7). One query and one mutation: a value card saves its own patch and
 * replaces the cache with the server's answer, the way every settings composable in the house does.
 */
export function useTelephonySettings() {
  const { $api } = useApi()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['telephony', 'settings'],
    queryFn: () => $api('/api/v1/telephony/settings', { schema: TelephonySettingsSchema }),
  })
  const save = useMutation({
    mutationFn: (patch: Partial<TelephonySettings>) =>
      $api('/api/v1/telephony/settings', { method: 'PATCH', body: patch, schema: TelephonySettingsSchema }),
    onSuccess: data => queryClient.setQueryData(['telephony', 'settings'], data),
  })
  return { ...query, save }
}
