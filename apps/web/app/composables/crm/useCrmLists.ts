import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { ZodType } from 'zod'
import {
  CrmLostReasonListSchema,
  CrmOutcomeListSchema,
  CrmPackageListSchema,
  CrmSourceListSchema,
  CrmStageListSchema,
  type CrmLostReason,
  type CrmOutcome,
  type CrmPackage,
  type CrmSource,
  type CrmStage,
} from '@webvue/contracts'
import { saveErrorMessage } from '../../utils/formFeedback'
import { crmKeys, type CrmListName } from './crmKeys'

// Archived rows are listed too (so they can be restored); the server caps a page at 200.
const LIST_LIMIT = 200

interface ListShape<Row> { items: Row[]; total: number }

// The five lists share one route shape: GET all, POST one, PATCH by id. A write refetches its list.
function useCrmList<Row>(name: CrmListName, schema: ZodType<ListShape<Row>>, enabled: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  return useQuery({
    queryKey: crmKeys.list(name),
    enabled: computed(() => toValue(enabled) && !!me.value && can('crm.settings.read')),
    queryFn: () => $api(`/api/v1/crm/${name}`, { query: { active: 'all', limit: LIST_LIMIT }, schema }),
  })
}

/**
 * Writes to one list. A row is archived and restored with `active` on a change, never deleted. `busy` holds the ids
 * with a write in flight (0 is the add form) and `message` the last refusal, in the user's words.
 */
export function useCrmListEditor<Row, Create extends object, Patch extends object>(name: CrmListName, rowSchema: ZodType<Row>) {
  const { $api } = useApi()
  const qc = useQueryClient()
  const { t } = useI18n()
  const busy = ref<number[]>([])
  const failure = ref<unknown>(null)
  const message = computed(() => (failure.value ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain')) : ''))
  async function write(id: number, request: () => Promise<unknown>): Promise<boolean> {
    failure.value = null
    busy.value = [...busy.value, id]
    try {
      await request()
      await qc.invalidateQueries({ queryKey: crmKeys.list(name) })
      return true
    } catch (error) {
      failure.value = error
      return false
    } finally {
      busy.value = busy.value.filter(item => item !== id)
    }
  }
  return {
    busy,
    message,
    add: (body: Create) => write(0, () => $api(`/api/v1/crm/${name}`, { method: 'POST', body, schema: rowSchema })),
    change: (id: number, body: Patch) => write(id, () => $api(`/api/v1/crm/${name}/${id}`, { method: 'PATCH', body, schema: rowSchema })),
  }
}

export const useCrmStages = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmStage>('stages', CrmStageListSchema, enabled)
export const useCrmOutcomes = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmOutcome>('outcomes', CrmOutcomeListSchema, enabled)
export const useCrmLostReasons = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmLostReason>('lost-reasons', CrmLostReasonListSchema, enabled)
export const useCrmSources = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmSource>('sources', CrmSourceListSchema, enabled)
export const useCrmPackages = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmPackage>('packages', CrmPackageListSchema, enabled)

export function useReorderCrmStages() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => $api('/api/v1/crm/stages/order', { method: 'POST', body: { ids }, schema: CrmStageListSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crmKeys.list('stages') }),
  })
}
