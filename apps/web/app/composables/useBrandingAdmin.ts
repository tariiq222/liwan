import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  BrandingSchema,
  type Branding,
  type BrandingPatch,
} from '@nasq/contracts'

export const brandingAdminKeys = {
  all: ['branding-admin'] as const,
}

export function useBrandingAdmin() {
  const { $api } = useApi()
  return useQuery({
    queryKey: brandingAdminKeys.all,
    queryFn: () => $api('/api/v1/admin/branding', { schema: BrandingSchema }),
  })
}

export function useUpdateBranding() {
  const queryClient = useQueryClient()
  const { $api } = useApi()
  const { data: publicBranding } = useNuxtData<Branding>('branding')
  return useMutation({
    // The optional logo can hold more than a megabyte of base64 text. Once
    // BrandingForm detaches after settlement, collect its variables now.
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
