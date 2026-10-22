import { computed } from 'vue'
import { attentionProviders } from '../modules/surfaces'
import { canReachPath } from '../utils/accessPolicy'
import { groupByWork, visibleProviders, WORK_ROWS_LIMIT } from './nav/attentionModel'
import { useAttention } from './useAttention'

/**
 * The user's own work for the personal surfaces (home): every application's attention rows grouped by kind. It is
 * `available` only when the user may open `/work` and at least one provider answers to their capabilities; otherwise
 * nothing is requested and the surfaces draw nothing.
 *
 * Gating decision (owner, 2026-10-22): the personal surfaces on home (indicators and the top of the work) require that
 * the user can reach `/work`, that is `tasks.tasks.read` and the tasks feature; without it home shows neither, even if
 * another application has attention rows for them.
 */
export function useMyWork() {
  const { me } = useMe()
  const { can } = useAccess()
  const available = computed(() => canReachPath(me.value, '/work') && visibleProviders(attentionProviders(), can).length > 0)
  const { rows, pending, failed, cappedKinds } = useAttention(() => (available.value ? 'all' : null), { limit: WORK_ROWS_LIMIT })
  return { available, rows, grouped: computed(() => groupByWork(rows.value)), pending, failed, cappedKinds }
}
