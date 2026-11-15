import type { SalesOrderListItem } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const SALES_STATE_TONE: Record<SalesOrderListItem['state'], StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  confirmed: 'success',
  cancelled: 'destructive',
}
