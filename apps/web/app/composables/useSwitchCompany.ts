import { MeCompanyInputSchema, MeSchema, type Me } from '@liwan/contracts'
import { companySwitching } from '../utils/companySwitch'

/**
 * Moves the session to another company of the tenant, one switch at a time (a second call while one runs does nothing).
 * The request names its target, so it states no expected company. The server answers first: a refused switch (404,
 * network) throws the mapped ApiError and leaves identity, branding and the live socket as they were. After it, `me` and
 * the branding are reloaded (the new company in `me` disposes the private query tree through the session scope); only
 * when `me` really names the requested company does the live socket reconnect, so it subscribes as that company, and
 * the person land on the home page.
 */
export function useSwitchCompany() {
  const { $api } = useApi()
  const { connect, disconnect } = useBus()
  const { t } = useI18n()
  const loadedMe = useNuxtData<Me | null>('me').data
  return async (companyId: number): Promise<void> => {
    if (companySwitching.value) return
    companySwitching.value = true
    try {
      await $api('/api/v1/me/company', { method: 'POST', body: MeCompanyInputSchema.parse({ company_id: companyId }), schema: MeSchema, statesCompany: false })
      await refreshNuxtData(['me', 'branding'])
      if (loadedMe.value?.company.id !== companyId) throw new Error(t('errors.generic'))
      disconnect()
      connect()
      await navigateTo('/')
    } finally {
      companySwitching.value = false
    }
  }
}
