import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  HrDocumentListSchema,
  HrDocumentSchema,
  type HrDocument,
} from '@nasq/contracts'
import {
  documentListQueryKey,
  invalidateDocumentLists,
  replaceDocumentDetail,
  type DocumentListQueryParams,
} from '../lib/documentListCache'

export type { HrDocument }

type HrDocumentListParams = DocumentListQueryParams

// TanStack serializes mutations sharing this scope. A single scope keeps
// update and attachment responses ordered when the same document is edited.
const documentWriteScope = { id: 'hr-document-write' }

export const hrDocumentKeys = {
  list: (params: HrDocumentListParams) => documentListQueryKey(params),
  detail: (id: number) => ['hr', 'document', id] as const,
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
          limit: Math.min(Math.max(p.limit ?? 200, 1), 200),
          offset: Math.max(p.offset ?? 0, 0),
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
    onSuccess: async (doc) => {
      replaceDocumentDetail(qc, doc)
      await invalidateDocumentLists(qc)
    },
  })
}

export function useUpdateDocument() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    scope: documentWriteScope,
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; body?: string } }) =>
      $api(`/api/v1/hr/documents/${id}`, { method: 'PATCH', body: patch, schema: HrDocumentSchema }),
    onSuccess: async (doc) => {
      replaceDocumentDetail(qc, doc)
      await invalidateDocumentLists(qc)
    },
  })
}

export function useUploadDocumentAttachment() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    scope: documentWriteScope,
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
    onSuccess: async (doc) => {
      replaceDocumentDetail(qc, doc)
      await invalidateDocumentLists(qc)
    },
  })
}
