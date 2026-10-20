import { describe, expect, it } from 'vitest'
import { budgetActions } from '../budgetActions'

const can = (capability: string) => capability === 'finance.budgets.manage'
const none = () => false

describe('budget actions by state', () => {
  it('a draft can be confirmed, cancelled and have lines added', () => {
    expect(budgetActions({ state: 'draft' }, can)).toEqual({ confirm: true, resetToDraft: false, cancel: true, editLines: true })
  })

  it('a confirmed budget can be reset or cancelled', () => {
    expect(budgetActions({ state: 'confirmed' }, can)).toEqual({ confirm: false, resetToDraft: true, cancel: true, editLines: false })
  })

  it('a cancelled budget can only be reset', () => {
    expect(budgetActions({ state: 'cancelled' }, can)).toEqual({ confirm: false, resetToDraft: true, cancel: false, editLines: false })
  })
})

describe('budget actions by capability', () => {
  it('everything needs the manage capability', () => {
    for (const state of ['draft', 'confirmed', 'cancelled'] as const) {
      expect(budgetActions({ state }, none)).toEqual({ confirm: false, resetToDraft: false, cancel: false, editLines: false })
    }
  })
})
