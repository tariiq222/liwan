import { BUSINESS_TIME_ZONE } from '@liwan/commercial-contracts'
import { formatDate, formatDateTime } from '@liwan/ui/app/utils/formatDate'

export { BUSINESS_TIME_ZONE }

/** dd/MM/yyyy for an instant on the Riyadh clock; a plain YYYY-MM-DD calendar day is shown as it is. */
export const formatBusinessDate = (value: string | number | Date | null | undefined): string => formatDate(value, BUSINESS_TIME_ZONE)

/** dd/MM/yyyy HH:mm for an instant, on the Riyadh clock. */
export const formatBusinessDateTime = (value: string | number | Date | null | undefined): string => formatDateTime(value, BUSINESS_TIME_ZONE)
