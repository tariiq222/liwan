import { FinanceAnalyticAccountListSchema } from '@liwan/contracts'
import { financeAnalyticKeys } from '../../composables/finance/useFinanceAnalytic'
import { fetchAllRecordOptions } from '../fetchAllRecordOptions'
import type { AppRecordPicker } from '../types'

export const COST_CENTER_PAGE = 200

/** The cost centers (analytic accounts) of the current company another application attaches its records to. */
export const costCenterPicker: AppRecordPicker = {
  kind: 'cost-center',
  capability: 'finance.analytic.read',
  queryKey: financeAnalyticKeys.costCenterOptions,
  options: (api, signal) => fetchAllRecordOptions(
    async (offset) => {
      const page = await api('/api/v1/finance/analytic-accounts', { query: { limit: COST_CENTER_PAGE, offset }, schema: FinanceAnalyticAccountListSchema })
      return page.items.map(account => ({ id: account.id, name: account.code ? `${account.code} · ${account.name}` : account.name }))
    },
    COST_CENTER_PAGE,
    signal,
  ),
}
