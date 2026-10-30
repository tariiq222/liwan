import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { ENTRIES_PATH, entryRecordPath } from './entryPaths'
import { useEntryListPage } from './useEntryListPage'

/**
 * What the entry create page needs: the list that stays behind the panel (its header hidden), the panel title and its
 * way back, and where a saved entry goes: its record page, carrying the same list origin.
 */
export function useEntryCreatePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, ENTRIES_PATH, [ENTRIES_PATH]))
  function saved(id: number) {
    void navigateTo({ path: entryRecordPath(id), query: { returnTo: backTo.value } }, { replace: true })
  }
  return reactive({
    list: useEntryListPage(true),
    title: t('financeAccounting.entries.new'),
    backTo,
    allowed: computed(() => can('finance.entries.manage')),
    saved,
  })
}
