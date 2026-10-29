import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  BrandingSchema,
  type Branding,
  type BrandingPatch,
} from '@webvue/contracts'

const brandingAdminKeys = {
  all: ['branding-admin'] as const,
}

export function useBrandingAdmin(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  return useQuery({
    queryKey: brandingAdminKeys.all,
    enabled: computed(() => toValue(enabled)),
    queryFn: () => $api('/api/v1/admin/branding', { schema: BrandingSchema }),
    retry: false,
  })
}

export function useUpdateBranding() {
  const queryClient = useQueryClient()
  const { $api } = useApi()
  const { data: publicBranding } = useNuxtData<Branding>('branding')
  return useMutation({
    gcTime: 0,
    mutationFn: (patch: BrandingPatch) => $api('/api/v1/admin/branding', {
      method: 'PATCH',
      body: patch,
      schema: BrandingSchema,
    }),
    onSuccess: (branding) => {
      queryClient.setQueryData(brandingAdminKeys.all, branding)
      publicBranding.value = branding
    },
  })
}
