import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  CompanyLookupListSchema,
  CompanyProfileSchema,
  type Branding,
  type CompanyLogoUpload,
  type CompanyProfile,
  type CompanyProfilePatch,
} from '@webvue/contracts'

const ROUTE = '/api/v1/admin/company'
const companyKeys = {
  all: ['company-profile'] as const,
  countries: ['company-profile', 'countries'] as const,
  states: (countryId: number) => ['company-profile', 'states', countryId] as const,
}

export function useCompanyProfile() {
  const { $api } = useApi()
  return useQuery({
    queryKey: companyKeys.all,
    queryFn: () => $api(ROUTE, { schema: CompanyProfileSchema }),
    retry: false,
  })
}

export function useCompanyCountries() {
  const { $api } = useApi()
  return useQuery({
    queryKey: companyKeys.countries,
    queryFn: () => $api(`${ROUTE}/countries`, { schema: CompanyLookupListSchema }),
    staleTime: Infinity,
  })
}

export function useCompanyStates(countryId: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => companyKeys.states(toValue(countryId) ?? 0)),
    queryFn: () => $api(`${ROUTE}/countries/${toValue(countryId)}/states`, { schema: CompanyLookupListSchema }),
    enabled: computed(() => toValue(countryId) !== null),
    staleTime: Infinity,
  })
}

/** The saved profile is the server's answer: it replaces the cache and the public branding's name and logo. */
function useSavedProfile() {
  const queryClient = useQueryClient()
  const { data: publicBranding } = useNuxtData<Branding>('branding')
  return (profile: CompanyProfile) => {
    queryClient.setQueryData(companyKeys.all, profile)
    if (publicBranding.value) publicBranding.value = { ...publicBranding.value, name: profile.name, logo_url: profile.logo_url }
  }
}

export function useUpdateCompany() {
  const { $api } = useApi()
  const saved = useSavedProfile()
  return useMutation({
    gcTime: 0,
    mutationFn: (patch: CompanyProfilePatch) => $api(ROUTE, { method: 'PATCH', body: patch, schema: CompanyProfileSchema }),
    onSuccess: saved,
  })
}

export function useUploadCompanyLogo() {
  const { $api } = useApi()
  const saved = useSavedProfile()
  return useMutation({
    gcTime: 0,
    mutationFn: (upload: CompanyLogoUpload) => $api(`${ROUTE}/logo`, { method: 'POST', body: upload, schema: CompanyProfileSchema }),
    onSuccess: saved,
  })
}
