import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

/** The business zone: the control plane renews, bills and cuts its periods on this clock (UTC+3 all year). */
export const BUSINESS_TIME_ZONE = 'Asia/Riyadh'

/** dd/MM/yyyy HH:mm for an instant, on the Riyadh clock. */
export const formatBusinessDateTime = (value: string | number | Date | null | undefined): string => formatDateTime(value, BUSINESS_TIME_ZONE)
