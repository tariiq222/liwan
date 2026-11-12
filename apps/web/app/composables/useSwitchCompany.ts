import { MeCompanyInputSchema, MeSchema, type Me } from '@liwan/contracts'
import { companySwitching } from '../utils/companySwitch'

/**
 * Moves the session to another company of the tenant, one switch at a time (a second call while one runs does nothing).
 * The person goes home first: reloading `me` disposes every mounted form with the private query tree, and only a route
 * change can ask about an unsaved draft. A guard that refuses the move (the unsaved-changes dialog took over) ends the
 * attempt before any request: nothing is sent, nothing is reloaded, and the person picks the company again after they
 * decide. Only on the home page does the request go out. It names its target, so it states no expected company. The
 * server answers: a refused switch (404, network) throws the mapped ApiError and leaves identity, branding and the live
 * socket as they were. After it, `me` and the branding are reloaded; only when `me` really names the requested company
 * does the live socket reconnect, so it subscribes as that company.
 */
export function useSwitchCompany() {
  const { $api } = useApi()
  const { connect, disconnect } = useBus()
  const { t } = useI18n()
  // The router's own current route: `useRoute()` follows it only once the destination page finished loading.
  const router = useRouter()
  const loadedMe = useNuxtData<Me | null>('me').data
  return async (companyId: number): Promise<void> => {
    if (companySwitching.value) return
    companySwitching.value = true
    try {
      await navigateTo('/')
      if (router.currentRoute.value.path !== '/') return
      await $api('/api/v1/me/company', { method: 'POST', body: MeCompanyInputSchema.parse({ company_id: companyId }), schema: MeSchema, statesCompany: false })
      await refreshNuxtData(['me', 'branding'])
      if (loadedMe.value?.company.id !== companyId) throw new Error(t('errors.generic'))
      disconnect()
      connect()
    } finally {
      companySwitching.value = false
    }
  }
}
