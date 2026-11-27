import type { TelephonyCall } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

type Party = Pick<TelephonyCall, 'partner' | 'remoteNumber' | 'extension'>

/** What names the other party of a call: the linked customer, else the number, else the extension. */
export function callParty(call: Party): string {
  return call.partner?.name || call.remoteNumber || call.extension?.name || ''
}

/** The number a call came or went through, or the other extension of an internal call; null when the wire carries neither. */
export function callNumber(call: Party): string | null {
  return call.remoteNumber || call.extension?.name || null
}

/**
 * When a moment of a call happened, in the reader's time zone, as the one datetime format of the app. The zone falls
 * back to the platform's own until the session states one, so the server and the hydrating browser never pick two.
 */
export function callTime(value: string | null, timeZone: string | undefined): string | null {
  if (!value) return null
  return formatDateTime(value, timeZone || 'Asia/Riyadh') || null
}

/** The length of a call as `m:ss`; null while the call has not ended. */
export function callDuration(seconds: number | null): string | null {
  if (!seconds) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
