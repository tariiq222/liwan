import { useFinanceEntryList } from '@/composables/finance/useFinanceEntries'
import { entryFiltersFromQuery, entryListParams } from './entryListParams'
import { ENTRIES_PATH } from './entryPaths'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'

/**
 * The heading of the journal entries list page: title, the result count as a tag and the create link,
 * which carries the list's filters as its returnTo. The page owns the SharedListPage shell and EntryList draws the
 * card in it; `background` is the list behind the create panel, so its header is hidden. The result is reactive so
 * `v-bind` in the page template unwraps the computed values.
 */
export function useEntryListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const filterQuery = useListFilterQuery(ENTRIES_PATH, background)
  const filters = computed(() => entryFiltersFromQuery(filterQuery.value))
  const query = useFinanceEntryList(() => entryListParams(filters.value), () => can('finance.entries.read'))
  const location = useListLocation(ENTRIES_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeAccounting.entries.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.entries.manage') ? { path: `${ENTRIES_PATH}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t('financeAccounting.entries.title'),
    tags,
    createTo,
    createLabel: t('financeAccounting.entries.new'),
    createTestId: 'finance-entry-new',
    hideHeader: background,
    kpiToggle: true,
  })
}
