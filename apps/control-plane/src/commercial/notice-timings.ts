/** Where the customer-facing notice timings live, in days; changing a product default is changing this file. */

/** A trial's end notices: this many days before it ends (only thresholds below the trial's own length are sent). */
export const TRIAL_NOTICE_DAYS = [3, 1] as const

/** A renewal that owes money: this many days before it (only thresholds shorter than the billing cadence are sent). */
export const RENEWAL_NOTICE_DAYS = [7, 3, 1] as const

/** A past-due subscription whose plan suspends automatically: this many days before access stops (only thresholds shorter than the plan's grace period are sent). */
export const SUSPENSION_NOTICE_DAYS = [3, 1] as const

/** A cancelled subscription: the reminder goes this many days before the paid period ends. */
export const CANCELLATION_REMINDER_DAYS = 3

/** A confirmed workspace deletion: the reminders go this many days before it falls due (the nearest one not yet passed is sent after a worker outage). */
export const TENANT_DELETION_REMINDER_DAYS = [60, 30, 14, 7, 1] as const

/**
 * A saved card is charged on the day the renewal invoice is issued (day 0) and, after a soft decline, again this many days after the
 * issue date. A hard decline stops at once. The invoice's due date and the dunning that follows it do not depend on these.
 */
export const SAVED_CARD_CHARGE_DAYS = [0, 1, 3, 5] as const

/** A saved-card charge whose answer was lost is looked up (by its attempt id) and, when the provider has none, sent again as the same attempt after this many minutes. */
export const SAVED_CARD_REDRIVE_MINUTES = 5

/** The default card's expiry: the notice goes this many days before its last valid day. */
export const CARD_EXPIRY_NOTICE_DAYS = [30, 7] as const
