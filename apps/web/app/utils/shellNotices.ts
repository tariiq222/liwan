import { dayBefore, trialDaysRemaining } from './subscription'

/**
 * The one subscription notice the shell may show. `selectNotice` is pure: the composable `useShellNotice` gathers
 * the inputs, a layout renders the result. Dates in `params` are ISO calendar days; the renderer formats them.
 */
export type ShellNoticeSeverity = 'info' | 'warning' | 'error'
export interface ShellNotice {
  key: ShellNoticeKey
  /** An escalation band inside one key (the trial notice gets sharper as the end nears); a dismissal covers one band only. */
  level?: string
  severity: ShellNoticeSeverity
  messageKey: string
  params: Record<string, string | number>
  action?: { labelKey: string, to: string }
  /** `false` cannot be dismissed; `{ hours }` hides this notice (and band) that long. */
  dismissible: false | { hours: number }
}
export type ShellNoticeKey = 'payment_suspended' | 'user_read_only' | 'payment_overdue' | 'trial_ending' | 'cancellation_scheduled' | 'free_base_lock_pending'

/** Exactly the fields of the subscription view the rules read (declared here so this file imports no commercial contract). */
export interface NoticeSubscription {
  state: string
  trial_ends_at: string | null
  grace_ends_at: string | null
  cancellation?: { effective_on: string } | null
  pending_free_base_lock?: string | null
}

export interface ShellNoticeInputs {
  now: Date
  /** `/me` `commercial.mode`; `non_saas` shows no subscription notice at all (R8). */
  commercialMode: 'saas' | 'non_saas' | null | undefined
  /** `/me` `platform.state`, taken as a string: `payment_suspended` is the tenant lock for an unpaid invoice. */
  platformState: string | null | undefined
  /** `/me` `read_only`: this user is read-only (for example above the seat limit). */
  userReadOnly: boolean
  /** The user derives `subscription.manage`; managers alone see billing detail. */
  canManage: boolean
  /** The subscription view, only ever loaded for a user who derives `subscription.read`. */
  subscription: NoticeSubscription | null
  /** Whether a dismissal of this notice is still in force. */
  isDismissed: (notice: ShellNotice) => boolean
}

export const NOTICE_DISMISS_HOURS = 24
/** The trial notice shows from this many days before the end. */
export const TRIAL_NOTICE_DAYS = 7
/** From this many days before the end (inclusive) the overdue notice can no longer be dismissed. */
export const OVERDUE_FINAL_DAYS = 3
/** From this many days before the end (inclusive) the trial notice can no longer be dismissed: the last day. */
export const TRIAL_FINAL_DAYS = 1

const PAY = { labelKey: 'subscription.notice.actions.pay', to: '/subscription' }
const CHOOSE_PLAN = { labelKey: 'subscription.notice.actions.choosePlan', to: '/subscription/change' }
const RESUME = { labelKey: 'subscription.notice.actions.resume', to: '/subscription' }
const DAILY = { hours: NOTICE_DISMISS_HOURS }

/** The dismissal id: the key, plus the band when the notice has one. */
export function noticeId(notice: Pick<ShellNotice, 'key' | 'level'>): string {
  return notice.level ? `${notice.key}:${notice.level}` : notice.key
}

/**
 * Candidates in priority order (highest first). Implemented from today's inputs: all six rules. Not produced yet:
 * the trial end for a plain member (waits for `/me` to carry the date) and the overdue grace date for a member
 * (same). A candidate whose input is missing is simply absent.
 */
function candidates(input: ShellNoticeInputs): ShellNotice[] {
  const { subscription: sub, canManage, now } = input
  const list: ShellNotice[] = []
  if (input.platformState === 'payment_suspended') {
    list.push({
      key: 'payment_suspended', severity: 'error', params: {}, dismissible: false,
      messageKey: canManage ? 'subscription.notice.paymentSuspended.manager' : 'subscription.notice.paymentSuspended.member',
      ...(canManage ? { action: PAY } : {}),
    })
  }
  if (input.userReadOnly) {
    list.push({ key: 'user_read_only', severity: 'warning', params: {}, dismissible: false, messageKey: 'subscription.notice.userReadOnly' })
  }
  if (canManage && sub) {
    const grace = sub.state === 'past_due' ? trialDaysRemaining(sub.grace_ends_at, now) : null
    if (grace !== null) {
      const final = grace <= OVERDUE_FINAL_DAYS
      list.push({
        key: 'payment_overdue', level: final ? 'final' : 'early', severity: final ? 'error' : 'warning', action: PAY,
        params: { date: sub.grace_ends_at!.slice(0, 10), days: grace }, messageKey: 'subscription.notice.paymentOverdue',
        dismissible: final ? false : DAILY,
      })
    }
    const trial = sub.state === 'trialing' ? trialDaysRemaining(sub.trial_ends_at, now) : null
    if (trial !== null && trial <= TRIAL_NOTICE_DAYS) {
      const final = trial <= TRIAL_FINAL_DAYS
      list.push({
        key: 'trial_ending', level: final ? 'final' : trial <= OVERDUE_FINAL_DAYS ? 'soon' : 'early', severity: final ? 'warning' : 'info', action: CHOOSE_PLAN,
        params: { days: trial }, messageKey: 'subscription.notice.trialEnding', dismissible: final ? false : DAILY,
      })
    }
    if (sub.cancellation) {
      list.push({
        key: 'cancellation_scheduled', severity: 'info', action: RESUME, dismissible: DAILY,
        // The effective day is the renewal day: the last paid day is the one before it, as the subscription page says.
        params: { date: dayBefore(sub.cancellation.effective_on) }, messageKey: 'subscription.notice.cancellationScheduled',
      })
    }
    if (sub.pending_free_base_lock) {
      list.push({
        key: 'free_base_lock_pending', severity: 'info', dismissible: DAILY, params: {}, action: CHOOSE_PLAN,
        messageKey: 'subscription.notice.freeBaseLockPending',
      })
    }
  }
  return list
}

/** The single notice to show, or null. A dismissed notice steps aside for the next one in priority order. */
export function selectNotice(input: ShellNoticeInputs): ShellNotice | null {
  if (input.commercialMode === 'non_saas') return null
  return candidates(input).find(notice => !input.isDismissed(notice)) ?? null
}

const STORAGE_PREFIX = 'liwan:shell-notice:'

/** The browser's local storage, or null on the server or when the browser blocks it. */
export function noticeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Whether a stored dismissal of `notice` is still in force at `now`. Never throws; no storage means not dismissed. */
export function isNoticeDismissed(storage: ReturnType<typeof noticeStorage>, notice: ShellNotice, now: Date): boolean {
  if (!notice.dismissible) return false
  try {
    const until = Number(storage?.getItem(STORAGE_PREFIX + noticeId(notice)))
    return Number.isFinite(until) && until > now.getTime()
  } catch {
    return false
  }
}

/** Records the dismissal of `notice` for its own hours. A blocked or full storage drops it silently. */
export function dismissNotice(storage: ReturnType<typeof noticeStorage>, notice: ShellNotice, now: Date): void {
  if (!notice.dismissible) return
  try {
    storage?.setItem(STORAGE_PREFIX + noticeId(notice), String(now.getTime() + notice.dismissible.hours * 3_600_000))
  } catch {
    // The notice simply shows again on the next visit.
  }
}
