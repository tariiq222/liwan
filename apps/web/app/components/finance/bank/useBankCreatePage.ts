import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { BANK_STATEMENTS_PATH, statementPath } from './bankModel'
import { useBankListPage } from './useBankListPage'

/**
 * What the statement create page needs: the statements list behind the panel and the panel's way back (the list it
 * opened from). A saved statement opens as a record that returns to the same list.
 */
export function useBankCreatePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, BANK_STATEMENTS_PATH, [BANK_STATEMENTS_PATH]))
  function saved(statementId: number) {
    void navigateTo({ path: statementPath(statementId), query: { returnTo: backTo.value } }, { replace: true })
  }
  return reactive({
    list: useBankListPage(true),
    title: t('financeBank.form.title'),
    backTo,
    allowed: computed(() => can('finance.bank.manage')),
    saved,
  })
}
