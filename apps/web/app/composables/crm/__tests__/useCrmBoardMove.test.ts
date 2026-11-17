import { describe, expect, it, vi } from 'vitest'
import type { CrmOpportunity, CrmStage } from '@liwan/contracts'
import { useCrmBoardMove } from '../useCrmBoardMove'
import type { BoardMove } from '../../../utils/crmBoardMove'

const stage = (id: number, is_won = false): CrmStage => ({ id, name: `stage-${id}`, sequence: id, is_won, active: true })
const record = (win_by_order = false) => ({ id: 7, contact_name: 'Ahmad', stage: { id: 1, name: 'stage-1' }, win_by_order }) as CrmOpportunity

function setup(failure?: unknown) {
  const write = () => ({ mutateAsync: vi.fn(async () => { if (failure) throw failure }) })
  const actions = { patch: write(), sell: write(), lose: write() }
  const notify = vi.fn()
  const mover = useCrmBoardMove({ actions: actions as never, t: key => key, notify })
  const revert = vi.fn()
  const move = (to: BoardMove['to'], win = false): BoardMove => ({ item: record(win), to, revert })
  return { actions, notify, mover, revert, move }
}

describe('useCrmBoardMove', () => {
  it('sends a drop on an ordinary stage at once with the page stage PATCH, no sheet, and confirms with a toast', async () => {
    const { actions, notify, mover, move, revert } = setup()
    await mover.request(move(stage(2)))
    expect(actions.patch.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { stage_id: 2 } })
    expect(mover.active.value).toBeNull()
    expect(notify).toHaveBeenCalledWith('crm.opportunities.record.stageSaved', 'success')
    expect(revert).not.toHaveBeenCalled()
  })

  it('puts the card back and shows the refusal when the plain move is refused', async () => {
    const { notify, mover, move, revert } = setup({ status: 409, code: 'conflict' })
    await mover.request(move(stage(2)))
    expect(revert).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('crm.opportunities.errors.conflict', 'error')
  })

  it('opens the sheet for the sold stage and completes the sale with the record page call on confirm', async () => {
    const { actions, notify, mover, move } = setup()
    await mover.request(move(stage(4, true)))
    expect(actions.patch.mutateAsync).not.toHaveBeenCalled()
    expect(mover.active.value?.to).toMatchObject({ id: 4 })
    await mover.confirm({ kind: 'sale', packageId: 2, finalPrice: 250 })
    expect(actions.sell.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { package_id: 2, final_price: 250 } })
    expect(mover.active.value).toBeNull()
    expect(notify).toHaveBeenCalledWith('crm.opportunities.sale.sold', 'success')
  })

  it('opens the sheet for the lost zone and closes the record with the chosen reason', async () => {
    const { actions, mover, move } = setup()
    await mover.request(move('lost'))
    expect(mover.active.value?.to).toBe('lost')
    await mover.confirm({ kind: 'lost', lostReasonId: 3 })
    expect(actions.lose.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { lost_reason_id: 3 } })
    expect(mover.active.value).toBeNull()
  })

  it('opens the sheet with the stage picker for the move action and sends the chosen stage', async () => {
    const { actions, mover, move } = setup()
    await mover.request(move('pick'))
    expect(mover.active.value?.to).toBe('pick')
    await mover.confirm({ kind: 'stage', stageId: 3 })
    expect(actions.patch.mutateAsync).toHaveBeenCalledWith({ id: 7, body: { stage_id: 3 } })
    expect(mover.active.value).toBeNull()
  })

  it('puts the card back and closes the sheet on cancel, sending nothing', async () => {
    const { actions, mover, move, revert } = setup()
    await mover.request(move(stage(4, true)))
    mover.cancel()
    expect(revert).toHaveBeenCalledOnce()
    expect(mover.active.value).toBeNull()
    expect(actions.sell.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the sheet open with the refusal inside when the write is refused', async () => {
    const { mover, move, revert } = setup({ status: 403, code: 'forbidden' })
    await mover.request(move(stage(4, true)))
    await mover.confirm({ kind: 'sale', packageId: 1, finalPrice: 10 })
    expect(mover.active.value).not.toBeNull()
    expect(mover.error.value).toBe('crm.opportunities.errors.discountApproval')
    expect(mover.pending.value).toBe(false)
    expect(revert).not.toHaveBeenCalled()
  })

  it('refuses the sold stage while an order wins, sending nothing and putting the card back', async () => {
    const { actions, mover, move, revert } = setup()
    await mover.request(move(stage(4, true), true))
    expect(revert).toHaveBeenCalledOnce()
    expect(mover.active.value).toBeNull()
    expect(actions.sell.mutateAsync).not.toHaveBeenCalled()
  })
})

describe('useCrmBoardMove conflicts and repeated drops', () => {
  it('shows the customer-conflict message with the record link, never the discount text, when a sale stops at shared-phone customers', async () => {
    const candidates = [{ id: 5, name: 'Acme', phone_last4: '1234' }]
    const { mover, move } = setup({ status: 409, code: 'conflict', details: { candidates } })
    await mover.request(move(stage(4, true)))
    await mover.confirm({ kind: 'sale', packageId: 1, finalPrice: 10 })
    expect(mover.conflict.value).toBe(true)
    expect(mover.error.value).toBe('crm.opportunities.move.customerConflict')
    expect(mover.active.value).not.toBeNull()
  })

  it('ignores a second drop of a card whose plain move is still pending', async () => {
    const { actions, mover, move } = setup()
    const first = mover.request(move(stage(2)))
    await mover.request(move(stage(3)))
    await first
    expect(actions.patch.mutateAsync).toHaveBeenCalledTimes(1)
  })
})
