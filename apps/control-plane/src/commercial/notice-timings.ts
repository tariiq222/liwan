/** Where the customer-facing notice timings live, in days; changing a product default is changing this file. */

/** A trial's end notices: this many days before it ends (only thresholds below the trial's own length are sent). */
export const TRIAL_NOTICE_DAYS = [3, 1] as const

/** The notice before an automatic renewal charges the stored payment method, and the vendor's "renewals due soon" window. Shared with the customer page, so it lives in the contracts. */
export { RENEWAL_NOTICE_DAYS } from '@liwan/commercial-contracts'

/** After a trial lapsed, how long an order that is paid or being fulfilled may delay lowering to the free base before the vendor is told. */
export const FREE_BASE_ORDER_WAIT_DAYS = 3
