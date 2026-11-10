/** Where the customer-facing notice timings live, in days; changing a product default is changing this file. */

/** A trial's end notices: this many days before it ends (only thresholds below the trial's own length are sent). */
export const TRIAL_NOTICE_DAYS = [3, 1] as const

/** Days before the renewal date in Riyadh. Delivery is timely through the end of D-7. */
export const RENEWAL_NOTICE_LEAD_DAYS = 10
export const RENEWAL_NOTICE_MIN_DAYS = 7
