import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { CompanyTaxSchema, type CompanyTax, type CompanyTaxPatch } from '@liwan/contracts'

const ROUTE = '/api/v1/admin/company/tax'

export const companyTaxKeys = {
  /** One decision for the establishment, read from whichever company the session works in. */
  establishment: (companyId: number | undefined) => ['company-tax', { companyId }] as const,
}

export function useCompanyTax(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => companyTaxKeys.establishment(me.value?.company?.id)),
    enabled: computed(() => toValue(enabled) && !!me.value),
    queryFn: () => $api(ROUTE, { schema: CompanyTaxSchema }),
    retry: false,
  })
}

/**
 * One PATCH with only the changed fields. The answer replaces the cached choice; the company profile is refreshed as
 * well because VAT registration lives on the profile and decides whether its number field shows.
 */
export function useSaveCompanyTax() {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { me } = useMe()
  return useMutation({
    mutationFn: async (body: CompanyTaxPatch) => {
      const key = companyTaxKeys.establishment(me.value?.company?.id)
      const saved: CompanyTax = await $api(ROUTE, { method: 'PATCH', body, schema: CompanyTaxSchema })
      await qc.cancelQueries({ queryKey: key, exact: true })
      qc.setQueryData(key, saved)
      await qc.invalidateQueries({ queryKey: ['company-profile'] })
      return saved
    },
  })
}
