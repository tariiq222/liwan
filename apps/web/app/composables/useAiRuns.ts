import type { MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AiRunListSchema, AiRunSummarySchema, type AiRunList, type AiRunPatch, type AiRunSummary } from '@liwan/contracts'

export const aiRunKeys = {
  all: ['ai', 'runs'] as const,
  list: (userId: number | undefined, archived: boolean) => [...aiRunKeys.all, userId, archived] as const,
}

/** The signed-in user's own conversation history, newest first (or only the archived ones); the server never returns anyone else's. */
export function useAiRuns(archived: MaybeRefOrGetter<boolean> = false) {
  const { $api } = useApi()
  const { me } = useMe()
  const userId = computed(() => me.value?.id)
  return useQuery({
    queryKey: computed(() => aiRunKeys.list(userId.value, toValue(archived))),
    // The view comes from the key, not from `archived`: observers of one key share a query and the last one's queryFn runs,
    // so a closure over the ref would fetch the other list into this key after the view switched.
    queryFn: ({ queryKey }) => $api('/api/ai/runs', { query: queryKey[3] ? { archived: 'true' } : undefined, schema: AiRunListSchema }),
    // The request is the browser's own: the server-side render carries no session for this route.
    enabled: computed(() => import.meta.client && Boolean(userId.value)),
    retry: false,
  })
}

/** The cached list after the server answered a change of one row: the server's row replaces it, unless it moved to the other list. */
export function withPatchedRun(list: AiRunList, run: AiRunSummary): AiRunList {
  const items = list.items.flatMap(item => item.run_id !== run.run_id ? [item] : item.archived === run.archived ? [run] : [])
  return { items, total: items.length }
}

/** Rename and archive one conversation. The server's row replaces the cached one; a row that changed list leaves the list it was in. */
export function useAiRunActions() {
  const { $api } = useApi()
  const queryClient = useQueryClient()
  const patch = useMutation({
    mutationFn: ({ id, ...body }: AiRunPatch & { id: string }) => $api(`/api/ai/runs/${encodeURIComponent(id)}`, { method: 'PATCH', body, schema: AiRunSummarySchema }),
    onSuccess: async (run) => {
      queryClient.setQueriesData<AiRunList>({ queryKey: aiRunKeys.all }, list => list && withPatchedRun(list, run))
      await queryClient.invalidateQueries({ queryKey: aiRunKeys.all })
    },
  })
  return {
    rename: (id: string, title: string) => patch.mutateAsync({ id, title }),
    setArchived: (id: string, archived: boolean) => patch.mutateAsync({ id, archived }),
    pending: patch.isPending,
  }
}
