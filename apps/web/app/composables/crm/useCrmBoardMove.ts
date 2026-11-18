import { ref } from 'vue'
import { crmErrorMessage } from '../../utils/crmErrors'
import { customerConflictCandidates } from '../customers/customerErrors'
import { stageMoveKind, type BoardMove, type MovePayload } from '../../utils/crmBoardMove'
import type { useCrmOpportunityActions } from './useOpportunities'

type Actions = Pick<ReturnType<typeof useCrmOpportunityActions>, 'patch' | 'sell' | 'lose'>

interface Deps {
  actions: Actions
  t: (key: string) => string
  notify: (message: string, tone: 'success' | 'error') => void
}

/**
 * The moves of the stage board. A move to an ordinary stage is sent at once (the card stays where it was dropped and
 * goes back with the refusal shown); one that needs input (the sold stage, the lost zone, the «move» action) waits in
 * `active` for the sheet, which asks for just that input. Every write is the one the record page sends.
 */
export function useCrmBoardMove({ actions, t, notify }: Deps) {
  const active = ref<BoardMove | null>(null)
  const pending = ref(false)
  const error = ref('')
  // The sale stopped at customers sharing the record's phone: the sheet points to the record, where the choice is made.
  const conflict = ref(false)
  // Cards whose plain move is in flight: a second drop of the same card waits for the first answer.
  const moving = new Set<number>()

  async function send(move: BoardMove, payload: MovePayload) {
    const { id } = move.item
    if (payload.kind === 'stage') {
      await actions.patch.mutateAsync({ id, body: { stage_id: payload.stageId } })
      notify(t('crm.opportunities.record.stageSaved'), 'success')
    } else if (payload.kind === 'sale') {
      await actions.sell.mutateAsync({ id, body: { package_id: payload.packageId, final_price: payload.finalPrice } })
      notify(t('crm.opportunities.sale.sold'), 'success')
    } else {
      await actions.lose.mutateAsync({ id, body: { lost_reason_id: payload.lostReasonId } })
      notify(t('crm.opportunities.lost.done'), 'success')
    }
  }

  async function request(move: BoardMove) {
    error.value = ''
    conflict.value = false
    if (moving.has(move.item.id)) return
    if (move.to === 'lost' || move.to === 'pick' || stageMoveKind(move.to, move.item) === 'sale') {
      active.value = move
      return
    }
    if (stageMoveKind(move.to, move.item) === 'blocked') {
      move.revert()
      return
    }
    moving.add(move.item.id)
    try {
      await send(move, { kind: 'stage', stageId: move.to.id })
    } catch (failure) {
      move.revert()
      notify(crmErrorMessage(failure, t), 'error')
    } finally {
      moving.delete(move.item.id)
    }
  }

  async function confirm(payload: MovePayload) {
    const move = active.value
    if (!move || pending.value) return
    pending.value = true
    error.value = ''
    conflict.value = false
    try {
      await send(move, payload)
      active.value = null
    } catch (failure) {
      conflict.value = customerConflictCandidates(failure) !== null
      error.value = conflict.value ? t('crm.opportunities.move.customerConflict') : crmErrorMessage(failure, t, { sale: payload.kind === 'sale' })
    } finally {
      pending.value = false
    }
  }

  function cancel() {
    if (pending.value) return
    active.value?.revert()
    active.value = null
    error.value = ''
    conflict.value = false
  }

  return { active, pending, error, conflict, request, confirm, cancel }
}
