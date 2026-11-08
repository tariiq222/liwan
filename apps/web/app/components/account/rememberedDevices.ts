import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  LoginDevicesForgottenSchema,
  RememberedDeviceListSchema,
  type LoginDevicesForgotten,
  type RememberedDeviceList,
} from '@liwan/contracts'

/** The account holder's own remembered browsers: a list read through the session API, never a token. */
export const rememberedDevicesKey = ['account', 'devices'] as const

export function useRememberedDevices() {
  const { $api } = useApi()
  return useQuery<RememberedDeviceList>({
    queryKey: rememberedDevicesKey,
    queryFn: () => $api('/api/v1/me/devices', { schema: RememberedDeviceListSchema }),
  })
}

export function useForgetDevices() {
  const queryClient = useQueryClient()
  return useMutation<LoginDevicesForgotten, unknown, void>({
    // The auth route forgets the browsers and its own device cookie; the one in use keeps working, so the
    // answer names the devices still remembered rather than emptying the list we just read. An empty JSON body
    // is what the same-origin guard requires of every mutation.
    mutationFn: async () => LoginDevicesForgottenSchema.parse(
      await $fetch('/api/auth/device', { method: 'DELETE', body: {} }),
    ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rememberedDevicesKey }),
  })
}
