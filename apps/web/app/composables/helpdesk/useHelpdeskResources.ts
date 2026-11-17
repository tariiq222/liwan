import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HelpdeskCategoryResourceSchema,
  HelpdeskResourceSchema,
  HelpdeskResourcesSchema,
  HelpdeskStageResourceSchema,
  HelpdeskTeamResourceSchema,
  type HelpdeskResources,
} from '@liwan/contracts'
import { helpdeskKeys } from './helpdeskKeys'

export type HelpdeskResourceKind = 'teams' | 'stages' | 'categories' | 'tags' | 'channels' | 'types'

/** One save body; the server validates the keys of each kind again. */
export type HelpdeskResourceSave = Record<string, unknown> & { name: string; id?: number }

const SAVED = {
  teams: HelpdeskTeamResourceSchema,
  stages: HelpdeskStageResourceSchema,
  categories: HelpdeskCategoryResourceSchema,
  tags: HelpdeskResourceSchema,
  channels: HelpdeskResourceSchema,
  types: HelpdeskResourceSchema,
}

export function useHelpdeskResources(enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi()
  const { me } = useMe()
  return useQuery({
    queryKey: computed(() => helpdeskKeys.resources(me.value?.company.id)),
    enabled: computed(() => Boolean(toValue(enabled))),
    queryFn: () => $api('/api/v1/helpdesk/settings/resources', { schema: HelpdeskResourcesSchema }),
  })
}

/**
 * Save one reference record of a kind. The mutation answers the saved row; every resource list and the ticket
 * reference lists refetch, so a rename reaches the ticket form at once.
 */
export function useSaveHelpdeskResource(kind: HelpdeskResourceKind) {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HelpdeskResourceSave) => $api(`/api/v1/helpdesk/settings/${kind}`, {
      method: 'POST', body, schema: SAVED[kind],
    }) as Promise<HelpdeskResources[typeof kind][number]>,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['helpdesk', 'settings'] })
      await qc.invalidateQueries({ queryKey: ['helpdesk', 'reference'] })
    },
  })
}
