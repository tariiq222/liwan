import { operationListLocation } from './forms'
import type { OperationScope } from './useOperations'

// The heading and the create link of an operations list page. The pages own the SharedListPage shell; RequestList and
// ProcessList draw the card in it. The create link carries the list's filters as its returnTo. The result is reactive so
// `v-bind` in the page template unwraps the computed create link.
export function useRequestListPage(scope: OperationScope) {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const path = scope === 'mine' ? '/operations' : `/operations/${scope}`
  const createTo = computed(() => can('operations.requests.create') ? { path: '/operations/new', query: { returnTo: operationListLocation(path, route.query, route.hash) } } : undefined)
  return reactive({ title: t(`operations.nav.${scope}`), createTo, createLabel: t('operations.newRequest') })
}

export function useProcessListPage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const createTo = computed(() => can('operations.processes.manage') ? { path: '/settings/apps/operations/processes/new', query: { returnTo: operationListLocation('/settings/apps/operations/processes', route.query, route.hash) } } : undefined)
  return reactive({ title: t('operations.nav.processes'), createTo, createLabel: t('operations.newProcess') })
}
