import type { FinanceAssetComputeResult } from '@webvue/contracts'
import { localIsoDay } from '@webvue/ui/app/utils/formatDate'
import { useComputeFinanceDepreciation } from '@/composables/finance/useFinanceAssets'
import { financeErrorMessage } from '../financeErrors'
import { assetErrorKey } from './assetErrors'

/**
 * The «post depreciation» action of the assets list: the header button opens an inline confirmation with the date,
 * the server posts every due line up to it, and the entries it created are shown until the next attempt. The server
 * has the last word: a future date or a locked period is refused and the message is shown inline.
 */
export function useAssetCompute() {
  const { t } = useI18n()
  const { can } = useAccess()
  const hydrated = useHydrated()
  const mutation = useComputeFinanceDepreciation()
  const today = localIsoDay()
  const open = ref(false)
  const date = ref<string | null>(today)
  const error = ref('')
  const result = ref<FinanceAssetComputeResult | null>(null)

  function start() {
    date.value = today
    error.value = ''
    result.value = null
    open.value = true
  }

  async function run() {
    if (!hydrated.value || !date.value || mutation.isPending.value) return
    error.value = ''
    try {
      result.value = await mutation.mutateAsync(date.value)
      open.value = false
    } catch (cause) {
      error.value = financeErrorMessage(cause, assetErrorKey, t)
    }
  }

  return reactive({
    allowed: computed(() => can('finance.assets.manage')),
    today,
    open,
    date,
    error,
    result,
    pending: mutation.isPending,
    hydrated,
    start,
    cancel: () => { open.value = false },
    run,
  })
}

export type AssetComputeState = ReturnType<typeof useAssetCompute>
