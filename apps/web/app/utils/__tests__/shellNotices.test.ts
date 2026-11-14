import { describe, expect, it } from 'vitest'
import { dismissNotice, isNoticeDismissed, noticeId, selectNotice, type NoticeSubscription, type ShellNoticeInputs } from '../shellNotices'

const NOW = new Date('2026-11-13T09:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const sub = (over: Partial<NoticeSubscription> = {}): NoticeSubscription => ({ state: 'active', trial_ends_at: null, grace_ends_at: null, cancellation: null, pending_free_base_lock: null, ...over })
const inputs = (over: Partial<ShellNoticeInputs> = {}): ShellNoticeInputs => ({
  now: NOW, commercialMode: 'saas', platformState: 'active', userReadOnly: false, canManage: true, subscription: sub(), isDismissed: () => false, ...over,
})
const key = (over: Partial<ShellNoticeInputs>) => selectNotice(inputs(over))?.key ?? null
const memoryStorage = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
}

describe('selectNotice rules', () => {
  it('shows nothing for a healthy subscription', () => expect(selectNotice(inputs())).toBeNull())

  it('1: tenant payment suspension reaches everyone, with pay for managers only, never dismissible', () => {
    const manager = selectNotice(inputs({ platformState: 'payment_suspended' }))!
    expect(manager).toMatchObject({ key: 'payment_suspended', dismissible: false, action: { to: '/subscription' } })
    const member = selectNotice(inputs({ platformState: 'payment_suspended', canManage: false, subscription: null }))!
    expect(member.key).toBe('payment_suspended')
    expect(member.action).toBeUndefined()
    expect(member.messageKey).toContain('member')
  })

  it('2: a read-only user sees it without billing detail or action', () => {
    const notice = selectNotice(inputs({ userReadOnly: true, canManage: false, subscription: null }))!
    expect(notice).toMatchObject({ key: 'user_read_only', dismissible: false })
    expect(notice.action).toBeUndefined()
  })

  it('3: overdue payment is for managers, dismissible until the last 3 days', () => {
    const early = selectNotice(inputs({ subscription: sub({ state: 'past_due', grace_ends_at: day(5) }) }))!
    expect(early).toMatchObject({ key: 'payment_overdue', level: 'early', dismissible: { hours: 24 }, action: { to: '/subscription' } })
    expect(early.params.days).toBe(5)
    expect(selectNotice(inputs({ subscription: sub({ state: 'past_due', grace_ends_at: day(4) }) }))!.dismissible).toEqual({ hours: 24 })
    expect(selectNotice(inputs({ subscription: sub({ state: 'past_due', grace_ends_at: day(3) }) }))).toMatchObject({ level: 'final', dismissible: false })
    expect(key({ canManage: false, subscription: sub({ state: 'past_due', grace_ends_at: day(5) }) })).toBeNull()
    expect(key({ subscription: sub({ state: 'past_due', grace_ends_at: null }) })).toBeNull()
  })

  it('4: the trial notice starts 7 days out, is dismissible until the last day, managers only', () => {
    expect(key({ subscription: sub({ state: 'trialing', trial_ends_at: day(8) }) })).toBeNull()
    const week = selectNotice(inputs({ subscription: sub({ state: 'trialing', trial_ends_at: day(7) }) }))!
    expect(week).toMatchObject({ key: 'trial_ending', level: 'early', dismissible: { hours: 24 }, action: { to: '/subscription/change' } })
    expect(selectNotice(inputs({ subscription: sub({ state: 'trialing', trial_ends_at: day(3) }) }))!.level).toBe('soon')
    expect(selectNotice(inputs({ subscription: sub({ state: 'trialing', trial_ends_at: day(1) }) }))).toMatchObject({ level: 'final', dismissible: false })
    expect(selectNotice(inputs({ subscription: sub({ state: 'trialing', trial_ends_at: day(0) }) }))!.dismissible).toBe(false)
    expect(key({ canManage: false, subscription: sub({ state: 'trialing', trial_ends_at: day(2) }) })).toBeNull()
  })

  it('5: a scheduled cancellation names the last paid day, the day before the effective day', () => {
    const notice = selectNotice(inputs({ subscription: sub({ cancellation: { effective_on: '2026-12-12' } }) }))!
    expect(notice).toMatchObject({ key: 'cancellation_scheduled', params: { date: '2026-12-11' }, action: { to: '/subscription' }, dismissible: { hours: 24 } })
  })

  it('6: a pending free-base lock is for managers and dismissible', () => {
    expect(selectNotice(inputs({ subscription: sub({ pending_free_base_lock: 'trial_end' }) }))).toMatchObject({ key: 'free_base_lock_pending', dismissible: { hours: 24 } })
    expect(key({ canManage: false, subscription: sub({ pending_free_base_lock: 'trial_end' }) })).toBeNull()
  })
})

describe('workspace deletion notice', () => {
  const confirmed = sub({ deletion: { state: 'confirmed', due_at: '2027-02-11T21:30:00Z', hold_until: null } })
  const hold = sub({ deletion: { state: 'due', due_at: '2027-02-11T21:30:00Z', hold_until: '2027-02-14T08:00:00Z' } })
  it('shows the dated, dismissible warning for a confirmed request, on the Riyadh day', () => {
    expect(selectNotice(inputs({ subscription: confirmed }))).toMatchObject({
      key: 'workspace_deletion', level: 'scheduled', severity: 'warning', dismissible: { hours: 24 }, params: { date: '2027-02-12' },
      action: { to: '/subscription#delete-workspace' },
    })
  })
  it('shows an undismissable error for the final hold', () => {
    expect(selectNotice(inputs({ subscription: hold }))).toMatchObject({ key: 'workspace_deletion', level: 'hold', severity: 'error', dismissible: false, params: { date: '2027-02-14' } })
  })
  it('shows nothing for an unconfirmed request, for deleting, for a plain member or when withdrawn', () => {
    for (const state of ['requested', 'deleting']) expect(key({ subscription: sub({ deletion: { state, due_at: '2027-02-12T00:00:00Z', hold_until: null } }) })).toBeNull()
    expect(key({ canManage: false, subscription: confirmed })).toBeNull()
    expect(key({ subscription: sub({ deletion: null }) })).toBeNull()
  })
  it('outranks the trial and cancellation notices but not payment suspension, read-only or an overdue payment', () => {
    const trialing = { state: 'trialing', trial_ends_at: day(2), cancellation: { effective_on: '2026-12-12' } }
    expect(key({ subscription: sub({ ...trialing, deletion: confirmed.deletion }) })).toBe('workspace_deletion')
    expect(key({ platformState: 'payment_suspended', subscription: confirmed })).toBe('payment_suspended')
    expect(key({ userReadOnly: true, subscription: confirmed })).toBe('user_read_only')
    expect(key({ subscription: sub({ state: 'past_due', grace_ends_at: day(2), deletion: confirmed.deletion }) })).toBe('payment_overdue')
    expect(key({ subscription: confirmed, isDismissed: n => n.key === 'workspace_deletion' })).toBeNull()
  })
})

describe('selectNotice priority and audience', () => {
  const everything = sub({ state: 'past_due', grace_ends_at: day(2), cancellation: { effective_on: '2026-12-12' }, pending_free_base_lock: 'refund' })
  it('returns the highest-priority notice only', () => {
    expect(key({ platformState: 'payment_suspended', userReadOnly: true, subscription: everything })).toBe('payment_suspended')
    expect(key({ userReadOnly: true, subscription: everything })).toBe('user_read_only')
    expect(key({ subscription: everything })).toBe('payment_overdue')
    expect(key({ subscription: sub({ cancellation: everything.cancellation, pending_free_base_lock: 'refund' }) })).toBe('cancellation_scheduled')
  })
  it('shows nothing at all in non_saas', () => {
    expect(key({ commercialMode: 'non_saas', platformState: 'payment_suspended', userReadOnly: true, subscription: everything })).toBeNull()
  })
  it('lets a dismissed notice step aside for the next, but never dismisses a non-dismissible one', () => {
    expect(key({ subscription: everything, isDismissed: n => n.key === 'payment_overdue' })).toBe('cancellation_scheduled')
    const early = sub({ state: 'past_due', grace_ends_at: day(6) })
    expect(key({ subscription: early, isDismissed: n => n.key === 'payment_overdue' })).toBeNull()
  })
})

describe('dismissal storage', () => {
  const notice = selectNotice(inputs({ subscription: sub({ state: 'past_due', grace_ends_at: day(6) }) }))!
  it('keys by notice and level', () => expect(noticeId(notice)).toBe('payment_overdue:early'))
  it('holds for 24 hours and then expires', () => {
    const storage = memoryStorage()
    dismissNotice(storage, notice, NOW)
    expect(isNoticeDismissed(storage, notice, new Date(NOW.getTime() + 23 * 3_600_000))).toBe(true)
    expect(isNoticeDismissed(storage, notice, new Date(NOW.getTime() + 24 * 3_600_000))).toBe(false)
  })
  it('does not carry a dismissal to another level', () => {
    const storage = memoryStorage()
    dismissNotice(storage, notice, NOW)
    expect(isNoticeDismissed(storage, { ...notice, level: 'final' }, NOW)).toBe(false)
  })
  it('never throws when storage is missing or blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(() => dismissNotice(null, notice, NOW)).not.toThrow()
    expect(() => dismissNotice(blocked, notice, NOW)).not.toThrow()
    expect(isNoticeDismissed(null, notice, NOW)).toBe(false)
    expect(isNoticeDismissed(blocked, notice, NOW)).toBe(false)
  })
  it('ignores a non-dismissible notice', () => {
    const storage = memoryStorage()
    const fixed = { ...notice, dismissible: false as const }
    dismissNotice(storage, fixed, NOW)
    expect(storage.getItem('liwan:shell-notice:payment_overdue:early')).toBeNull()
  })
})
