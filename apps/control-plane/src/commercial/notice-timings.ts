/** Where the customer-facing notice timings live, in days; changing a product default is changing this file. */

/** A trial's end notices: this many days before it ends (only thresholds below the trial's own length are sent). */
export const TRIAL_NOTICE_DAYS = [3, 1] as const

/** After a trial lapsed, how long an order that is paid or being fulfilled may delay the lock onto the free base before the vendor is told. */
export const FREE_BASE_ORDER_WAIT_DAYS = 3
