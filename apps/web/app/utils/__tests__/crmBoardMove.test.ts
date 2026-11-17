import { describe, expect, it } from 'vitest'
import type { CrmStage } from '@liwan/contracts'
import { canWorkOpportunity, moveChoices, stageMoveKind } from '../crmBoardMove'

const viewer = { work: true, assign: false, userId: 3 }
const mine = { status: 'pending', user: { id: 3, name: 'ليلى' } } as const
const sold = { id: 4, name: 'تم البيع', sequence: 40, is_won: true, active: true } satisfies CrmStage
const ordinary = { id: 2, name: 'تم التواصل', sequence: 20, is_won: false, active: true } satisfies CrmStage
const archived = { id: 5, name: 'قديمة', sequence: 50, is_won: false, active: false } satisfies CrmStage

describe('canWorkOpportunity', () => {
  it('lets the owner of a pending record work it', () => {
    expect(canWorkOpportunity(mine, viewer)).toBe(true)
  })

  it('lets someone who may assign work a record of another agent or of the pool', () => {
    expect(canWorkOpportunity({ ...mine, user: { id: 9, name: 'سارة' } }, { ...viewer, assign: true })).toBe(true)
    expect(canWorkOpportunity({ ...mine, user: null }, { ...viewer, assign: true })).toBe(true)
  })

  it('keeps the card of another agent, a pool card, a closed record and a viewer without crm.leads.work out', () => {
    expect(canWorkOpportunity({ ...mine, user: { id: 9, name: 'سارة' } }, viewer)).toBe(false)
    expect(canWorkOpportunity({ ...mine, user: null }, viewer)).toBe(false)
    expect(canWorkOpportunity({ ...mine, user: null }, { ...viewer, userId: undefined })).toBe(false)
    expect(canWorkOpportunity({ ...mine, status: 'won' }, { ...viewer, assign: true })).toBe(false)
    expect(canWorkOpportunity(mine, { ...viewer, work: false, assign: true })).toBe(false)
    expect(canWorkOpportunity(null, viewer)).toBe(false)
  })
})

describe('stageMoveKind', () => {
  it('moves to an ordinary stage with no question', () => {
    expect(stageMoveKind(ordinary, { win_by_order: false })).toBe('move')
    expect(stageMoveKind(ordinary, { win_by_order: true })).toBe('move')
  })

  it('asks for the sale on the sold stage, and refuses it while an order wins', () => {
    expect(stageMoveKind(sold, { win_by_order: false })).toBe('sale')
    expect(stageMoveKind(sold, { win_by_order: true })).toBe('blocked')
  })
})

describe('moveChoices', () => {
  const stages = [{ id: 1, name: 'جديد', sequence: 10, is_won: false, active: true }, ordinary, sold, archived]

  it('offers the active stages but the current one, with the sold stage when a sale may be made', () => {
    expect(moveChoices(stages, { stage: { id: 1, name: 'جديد' }, win_by_order: false }).map(stage => stage.id)).toEqual([2, 4])
  })

  it('drops the sold stage while an order wins', () => {
    expect(moveChoices(stages, { stage: { id: 1, name: 'جديد' }, win_by_order: true }).map(stage => stage.id)).toEqual([2])
  })
})
