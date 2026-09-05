import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrDocumentListSchema,
  HrDocumentSchema,
  type HrDocument,
  type HrDocumentList,
} from '@nasq/contracts'

export type { HrDocument, HrDocumentList }

export type HrDocumentListParams = {
  q?: string
  department_id?: number
}

export const hrDocumentKeys = {
  list: (params: HrDocumentListParams) => ['hr', 'documents', params] as const,
  detail: (id: number) => ['hr', 'document', id] as const,
}

function replaceDocumentInLists(qc: ReturnType<typeof useQueryClient>, doc: HrDocument, insert: boolean) {
  qc.setQueryData(hrDocumentKeys.detail(doc.id), doc)
  const lists = qc.getQueriesData<HrDocumentList>({ queryKey: ['hr', 'documents'] })
  for (const [key, data] of lists) {
    if (!data) continue
    const idx = data.items.findIndex((d) => d.id === doc.id)
    if (idx === -1) {
      if (!insert) continue
      qc.setQueryData(key, { items: [doc, ...data.items], total: data.total + 1 })
    } else {
      const items = data.items.slice()
      items[idx] = doc
      qc.setQueryData(key, { ...data, items })
    }
  }
}

export function useHrDocuments(params: MaybeRefOrGetter<HrDocumentListParams>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrDocumentKeys.list(toValue(params))),
    queryFn: () => {
      const p = toValue(params)
      return $api('/api/v1/hr/documents', {
        query: {
          q: p.q || undefined,
          department_id: p.department_id,
          limit: 200,
        },
        schema: HrDocumentListSchema,
      })
    },
  })
}

export function useHrDocument(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  return useQuery({
    queryKey: computed(() => hrDocumentKeys.detail(toValue(id) ?? 0)),
    enabled: computed(() => !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/documents/${toValue(id)}`, { schema: HrDocumentSchema }),
  })
}

export function useCreateDocument() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: (body: { name: string; body?: string; department_id: number }) =>
      $api('/api/v1/hr/documents', { method: 'POST', body, schema: HrDocumentSchema }),
    onSuccess: (doc) => replaceDocumentInLists(qc, doc, true),
  })
}

export function useUpdateDocument() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; body?: string } }) =>
      $api(`/api/v1/hr/documents/${id}`, { method: 'PATCH', body: patch, schema: HrDocumentSchema }),
    onSuccess: (doc) => replaceDocumentInLists(qc, doc, false),
  })
}

export function useUploadDocumentAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({
      id,
      name,
      datas,
      mimetype,
    }: {
      id: number
      name: string
      datas: string
      mimetype?: string
    }) =>
      $api(`/api/v1/hr/documents/${id}/attachments`, {
        method: 'POST',
        body: { name, datas, mimetype },
        schema: HrDocumentSchema,
      }),
    onSuccess: (doc) => replaceDocumentInLists(qc, doc, false),
  })
}
