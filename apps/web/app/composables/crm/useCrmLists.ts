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
} from '@liwan/contracts'
import { saveErrorMessage } from '../../utils/formFeedback'
import { crmKeys, type CrmListName } from './crmKeys'

// Archived rows are listed too (so they can be restored); the server caps a page at 200.
const LIST_LIMIT = 200

interface ListShape<Row> { items: Row[]; total: number }

// The five lists share one route shape: GET all, POST one, PATCH by id. A write refetches its list.
// `settings` is the manager's view (archived rows too, crm.settings.read); `choices` is what a record form offers
// (active rows only, any crm.leads.read holder: the server lets both capabilities read the lists).
type ListScope = 'settings' | 'choices'
function useCrmList<Row>(name: CrmListName, schema: ZodType<ListShape<Row>>, enabled: MaybeRefOrGetter<boolean>, scope: ListScope) {
  const { $api } = useApi()
  const { can } = useAccess()
  const { me } = useMe()
  const settings = scope === 'settings'
  return useQuery({
    queryKey: (settings ? crmKeys.list(name) : crmKeys.choices(name)) as readonly unknown[],
    enabled: computed(() => toValue(enabled) && !!me.value && can(settings ? 'crm.settings.read' : 'crm.leads.read')),
    queryFn: () => $api(`/api/v1/crm/${name}`, { query: { ...(settings ? { active: 'all' } : {}), limit: LIST_LIMIT }, schema }),
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
      await Promise.all([qc.invalidateQueries({ queryKey: crmKeys.list(name) }), qc.invalidateQueries({ queryKey: crmKeys.choices(name) })])
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

export const useCrmStages = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmStage>('stages', CrmStageListSchema, enabled, 'settings')
export const useCrmOutcomes = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmOutcome>('outcomes', CrmOutcomeListSchema, enabled, 'settings')
export const useCrmLostReasons = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmLostReason>('lost-reasons', CrmLostReasonListSchema, enabled, 'settings')
export const useCrmSources = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmSource>('sources', CrmSourceListSchema, enabled, 'settings')
export const useCrmPackages = (enabled: MaybeRefOrGetter<boolean> = true) => useCrmList<CrmPackage>('packages', CrmPackageListSchema, enabled, 'settings')

/** The active rows the opportunity pages offer, for anyone who may read leads. */
export const useCrmStageChoices = () => useCrmList<CrmStage>('stages', CrmStageListSchema, true, 'choices')
export const useCrmOutcomeChoices = () => useCrmList<CrmOutcome>('outcomes', CrmOutcomeListSchema, true, 'choices')
export const useCrmLostReasonChoices = () => useCrmList<CrmLostReason>('lost-reasons', CrmLostReasonListSchema, true, 'choices')
export const useCrmSourceChoices = () => useCrmList<CrmSource>('sources', CrmSourceListSchema, true, 'choices')
export const useCrmPackageChoices = () => useCrmList<CrmPackage>('packages', CrmPackageListSchema, true, 'choices')

export function useReorderCrmStages() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => $api('/api/v1/crm/stages/order', { method: 'POST', body: { ids }, schema: CrmStageListSchema }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: crmKeys.list('stages') }), qc.invalidateQueries({ queryKey: crmKeys.choices('stages') })]),
  })
}
