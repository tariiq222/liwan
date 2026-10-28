import { CRM_LIST_PATH, opportunityListLocation } from '@/utils/crmOpportunity'
import { useCrmTerms } from './useCrmTerms'

// The heading, the create link and the two views of the opportunities list page; the page owns the SharedListPage shell
// and CrmOpportunityList draws the card in it. The create link carries the list's state as its returnTo. The result is
// reactive so `v-bind` in the page template unwraps the computed values.
export function useOpportunityListPage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const { term } = useCrmTerms()
  const createTo = computed(() => can('crm.leads.work') || can('crm.leads.assign')
    ? { path: `${CRM_LIST_PATH}/new`, query: { returnTo: opportunityListLocation(route.query, route.hash) } }
    : undefined)
  const views = computed(() => [
    { value: 'list', label: t('crm.opportunities.list.viewList'), icon: 'i-lucide-list', testId: 'crm-view-list' },
    { value: 'board', label: t('crm.opportunities.list.viewBoard'), icon: 'i-lucide-columns-3', testId: 'crm-view-board' },
  ])
  return reactive({
    title: computed(() => term('opportunity', 'other')),
    createTo,
    createLabel: computed(() => t('crm.opportunities.list.new', { term: term('opportunity', 'one') })),
    views,
    viewsInFilters: true,
  })
}
