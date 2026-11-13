/** Where the customer-facing notice timings live, in days; changing a product default is changing this file. */

/** A trial's end notices: this many days before it ends (only thresholds below the trial's own length are sent). */
export const TRIAL_NOTICE_DAYS = [3, 1] as const

/** A renewal that owes money: this many days before it (only thresholds shorter than the billing cadence are sent). */
export const RENEWAL_NOTICE_DAYS = [7, 3, 1] as const

/** A past-due subscription whose plan suspends automatically: this many days before access stops (only thresholds shorter than the plan's grace period are sent). */
export const SUSPENSION_NOTICE_DAYS = [3, 1] as const

/** A cancelled subscription: the reminder goes this many days before the paid period ends. */
export const CANCELLATION_REMINDER_DAYS = 3
