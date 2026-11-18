import type { CrmOpportunity, CrmStage } from '@liwan/contracts'

/** Where a stage-board card is going: a stage column, the lost drop zone, or the «move» sheet's own stage picker. */
export type BoardMoveTarget = CrmStage | 'lost' | 'pick'

/** One requested move on the board. `revert` puts the card back in the column the data still says it is in. */
export interface BoardMove {
  item: CrmOpportunity
  to: BoardMoveTarget
  revert: () => void
}

/** What the move sheet asks for, once the required input is in: a stage, a sale, or a lost reason. */
export type MovePayload =
  | { kind: 'stage'; stageId: number }
  | { kind: 'sale'; packageId: number; finalPrice: number }
  | { kind: 'lost'; lostReasonId: number }

export interface Viewer { work: boolean; assign: boolean; userId?: number }

/** Whether the viewer may work a record: it is pending, they hold crm.leads.work, and they own it or may assign. */
export function canWorkOpportunity(record: Pick<CrmOpportunity, 'status' | 'user'> | null | undefined, viewer: Viewer): boolean {
  if (!record || record.status !== 'pending' || !viewer.work) return false
  return viewer.assign || (record.user !== null && record.user.id === viewer.userId)
}

/**
 * What a move to a stage needs: nothing («move»), the sale fields (the sold stage), or it is refused («blocked»: the
 * sold stage while an order wins the opportunity).
 */
export type StageMoveKind = 'move' | 'sale' | 'blocked'

export function stageMoveKind(stage: Pick<CrmStage, 'is_won'>, record: Pick<CrmOpportunity, 'win_by_order'>): StageMoveKind {
  if (!stage.is_won) return 'move'
  return record.win_by_order ? 'blocked' : 'sale'
}

/** The stages the «move» sheet offers: active ones other than the current one, the sold stage only when a sale may be made. */
export const moveChoices = (stages: CrmStage[], record: Pick<CrmOpportunity, 'stage' | 'win_by_order'>) =>
  stages.filter(stage => stage.active && stage.id !== record.stage?.id && stageMoveKind(stage, record) !== 'blocked')
