import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AiNoteListSchema, type AiNoteList } from '@liwan/contracts'

// The employee's own notes about their way of working, kept by the assistant (spec 2026-11-04 §6.4). Only they see them;
// deleting answers the remaining list, which replaces the cache.
const memoryKey = ['ai', 'memory'] as const

export function useAiMemory() {
  const { $api } = useApi()
  return useQuery({ queryKey: memoryKey, queryFn: () => $api('/api/ai/memory', { schema: AiNoteListSchema }), retry: false })
}

export function useForgetAiNotes() {
  const { $api } = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number | null) => $api(id === null ? '/api/ai/memory' : `/api/ai/memory/${id}`, { method: 'DELETE', body: {}, schema: AiNoteListSchema }),
    onSuccess: (list: AiNoteList) => qc.setQueryData(memoryKey, list),
  })
}
