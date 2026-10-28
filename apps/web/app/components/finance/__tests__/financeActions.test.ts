import { describe, expect, it } from 'vitest'
import { offeredMenuItems, readFinanceActions } from '../financeActions'

type Action = 'post' | 'cancel' | 'delete'
const record = {
  allowed_actions: ['post'] as Action[],
  blocked_actions: [
    { action: 'cancel', reason: 'has_payments' },
    { action: 'delete', reason: 'has_payments' },
  ] as const,
}

describe('finance actions read from the server', () => {
  it('runs only what the server allows and explains what it blocks', () => {
    const set = readFinanceActions<Action>(record)
    expect(set.can('post')).toBe(true)
    expect(set.can('cancel')).toBe(false)
    expect(set.blockedReason('cancel')).toBe('has_payments')
    expect(set.blockedReason('post')).toBeNull()
  })

  it('offers an allowed or blocked action and nothing else', () => {
    const set = readFinanceActions<Action>({ allowed_actions: ['post'], blocked_actions: [{ action: 'cancel', reason: 'period_locked' }] })
    expect(['post', 'cancel', 'delete'].map(action => set.offers(action as Action))).toEqual([true, true, false])
  })

  it('lists each blocking reason once, in the server order', () => {
    expect(readFinanceActions<Action>(record).reasons).toEqual(['has_payments'])
    expect(readFinanceActions<Action>({ allowed_actions: [], blocked_actions: [] }).reasons).toEqual([])
    const mixed = readFinanceActions<Action>({
      allowed_actions: [],
      blocked_actions: [{ action: 'post', reason: 'tenant_read_only' }, { action: 'cancel', reason: 'period_locked' }, { action: 'delete', reason: 'tenant_read_only' }],
    })
    expect(mixed.reasons).toEqual(['tenant_read_only', 'period_locked'])
  })

  it('builds menu rows for the offered actions in order and disables a blocked one', () => {
    const set = readFinanceActions<Action>(record)
    const rows = offeredMenuItems(set, [
      ['cancel', { label: 'Cancel' }],
      ['post', { label: 'Post' }],
      ['delete', { label: 'Delete', destructive: true }],
    ])
    expect(rows).toEqual([
      { label: 'Cancel', disabled: true },
      { label: 'Post', disabled: false },
      { label: 'Delete', destructive: true, disabled: true },
    ])
    expect(offeredMenuItems(readFinanceActions<Action>({ allowed_actions: [], blocked_actions: [] }), [['post', { label: 'Post' }]])).toEqual([])
  })
})
