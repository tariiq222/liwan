import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { DocumentListSchema, DocumentDetailSchema, DocumentFileListSchema, DocumentAccessSchema, DocumentTagListSchema, DocumentTagSchema, DocumentContextListSchema, DocumentContextOptionListSchema, type DocumentCreate, type DocumentPatch, type DocumentAccessUpdate, type DocumentUpload, type DocumentDetail, type DocumentAccess } from '@webvue/contracts'
import { ApiError } from './useApi'
import { documentKeys, type DocumentListQueryParams, type DocumentLookupParams } from '../lib/documentKeys'
import { replaceDocumentDetail, invalidateDocumentLists, preferNewerDocumentRevision } from '../lib/documentListCache'
export { documentKeys }

function useDocumentCompany() {
  const { me } = useMe()
  return computed(() => me.value?.company.id ?? null)
}

function assertDocumentCompany(current: number | null, expected: number) {
  if (current !== expected) throw new ApiError(409, 'company_changed', 'Company changed before the request started')
}

export function useDocuments(params: MaybeRefOrGetter<DocumentListQueryParams>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({
    enabled: computed(() => !!companyId.value && toValue(enabled)),
    queryKey: computed(() => documentKeys.list(companyId.value ?? 0, toValue(params))),
    queryFn: ({ queryKey, signal }) => {
      assertDocumentCompany(companyId.value, queryKey[1])
      const filters = queryKey[3]
      return $api('/api/v1/documents', { query: { ...filters, archived: filters.archived ? '1' : undefined, expired: filters.expired ? '1' : undefined }, signal, schema: DocumentListSchema })
    },
  })
}
export function useDocument(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({
    queryKey: computed(() => documentKeys.detail(companyId.value ?? 0, toValue(id) ?? 0)),
    enabled: computed(() => !!companyId.value && !!toValue(id)),
    queryFn: ({ queryKey, signal }) => {
      assertDocumentCompany(companyId.value, queryKey[1])
      return $api(`/api/v1/documents/${queryKey[3]}`, { signal, schema: DocumentDetailSchema })
    },
    structuralSharing: (previous, incoming) => preferNewerDocumentRevision(previous as DocumentDetail | undefined, incoming as DocumentDetail),
  })
}

export function useDocumentFiles(id: MaybeRefOrGetter<number | null>, params: MaybeRefOrGetter<DocumentListQueryParams>, revision: MaybeRefOrGetter<number>, onConflict?: () => void | Promise<unknown>) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  const recovering = ref(false); let recoveredKey: string | null = null
  const query = useQuery({
    queryKey: computed(() => documentKeys.filePage(companyId.value ?? 0, toValue(id) ?? 0, toValue(revision), toValue(params))),
    enabled: computed(() => !!companyId.value && !!toValue(id) && toValue(revision) > 0 && !recovering.value),
    retry: (count, cause) => !(cause instanceof ApiError && cause.status === 409) && count < 1,
    queryFn: ({ queryKey, signal }) => {
      assertDocumentCompany(companyId.value, queryKey[1])
      return $api(`/api/v1/documents/${queryKey[3]}/files`, { query: { ...queryKey[5], revision: queryKey[4] }, signal, schema: DocumentFileListSchema })
    },
  })
  watch(query.error, async cause => {
    if (!(cause instanceof ApiError) || cause.status !== 409 || !onConflict || recovering.value) return
    const key = `${companyId.value}:${toValue(id)}:${toValue(revision)}`
    if (key === recoveredKey) return
    recoveredKey = key; recovering.value = true
    try { await onConflict() }
    finally { recovering.value = false }
  })
  return { ...query, isRecovering: recovering }
}

/** Mutation variables are wire JSON. Capture their company and payload before any queued request or await. */
function useCompanyDocumentMutation<T, R>(
  request: (api: ReturnType<typeof useApi>['$api'], value: T) => Promise<R>,
  onSuccess: (companyId: number, client: ReturnType<typeof useQueryClient>, result: R, value: T) => Promise<unknown>,
) {
  const { $api } = useApi(); const client = useQueryClient(); const companyId = useDocumentCompany()
  const mutation = useMutation({
    mutationKey: computed(() => ['documents', companyId.value ?? 0, 'write']),
    scope: { id: 'documents-write' },
    mutationFn: (snapshot: { companyId: number; value: T }) => {
      assertDocumentCompany(companyId.value, snapshot.companyId)
      return request($api, snapshot.value)
    },
    onSuccess: (result, snapshot) => onSuccess(snapshot.companyId, client, result, snapshot.value),
  })
  function capture(value: T) {
    if (!companyId.value) throw new ApiError(403, 'forbidden', 'A current company is required')
    return { companyId: companyId.value, value: JSON.parse(JSON.stringify(value)) as T }
  }
  return {
    ...mutation,
    mutate: (value: T) => mutation.mutate(capture(value)),
    mutateAsync: async (value: T) => mutation.mutateAsync(capture(value)),
  }
}
function useDocumentMutation<T>(request: (api: ReturnType<typeof useApi>['$api'], value: T) => Promise<DocumentDetail>) {
  return useCompanyDocumentMutation(request, async (companyId, client, document) => {
    replaceDocumentDetail(client, companyId, document)
    await Promise.all([client.invalidateQueries({ queryKey: documentKeys.files(companyId, document.id) }), invalidateDocumentLists(client, companyId), client.invalidateQueries({ queryKey: documentKeys.access(companyId, document.id) })])
  })
}
export function useCreateDocument() { return useDocumentMutation((api, body: DocumentCreate) => api('/api/v1/documents', { method: 'POST', body, schema: DocumentDetailSchema })) }
export function useUpdateDocument() { return useDocumentMutation((api, value: { id: number; patch: DocumentPatch }) => api(`/api/v1/documents/${value.id}`, { method: 'PATCH', body: value.patch, schema: DocumentDetailSchema })) }
export function useDocumentTransition() { return useDocumentMutation((api, value: { id: number; action: 'archive' | 'restore'; expected_revision: number }) => api(`/api/v1/documents/${value.id}/${value.action}`, { method: 'POST', body: { expected_revision: value.expected_revision }, schema: DocumentDetailSchema })) }
export function useUploadDocumentFile() { return useDocumentMutation((api, value: { id: number; body: DocumentUpload }) => api(`/api/v1/documents/${value.id}/files`, { method: 'POST', body: value.body, schema: DocumentDetailSchema })) }
export function useDocumentFileAction() { return useDocumentMutation((api, value: { id: number; fileId: number; action: 'archive' | 'restore' | 'lock' | 'unlock'; expected_revision: number }) => api(`/api/v1/documents/${value.id}/files/${value.fileId}/${value.action}`, { method: 'POST', body: { expected_revision: value.expected_revision }, schema: DocumentDetailSchema })) }
export function useDocumentAccess(id: MaybeRefOrGetter<number | null>, allowed: MaybeRefOrGetter<boolean>) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({
    queryKey: computed(() => documentKeys.access(companyId.value ?? 0, toValue(id) ?? 0)),
    enabled: computed(() => !!companyId.value && !!toValue(id) && toValue(allowed)),
    queryFn: ({ queryKey, signal }) => {
      assertDocumentCompany(companyId.value, queryKey[1])
      return $api(`/api/v1/documents/${queryKey[3]}/access`, { signal, schema: DocumentAccessSchema })
    },
    structuralSharing: (previous, incoming) => preferNewerDocumentRevision(previous as DocumentAccess | undefined, incoming as DocumentAccess),
  })
}
export function useUpdateDocumentAccess() {
  return useCompanyDocumentMutation(
    (api, value: { id: number; body: DocumentAccessUpdate }) => api(`/api/v1/documents/${value.id}/access`, { method: 'PUT', body: value.body, schema: DocumentAccessSchema }),
    async (companyId, client, access, value) => {
      client.setQueryData<DocumentAccess>(documentKeys.access(companyId, value.id), previous => preferNewerDocumentRevision(previous, access))
      await Promise.all([client.invalidateQueries({ queryKey: documentKeys.detail(companyId, value.id) }), client.invalidateQueries({ queryKey: documentKeys.files(companyId, value.id) }), invalidateDocumentLists(client, companyId)])
    },
  )
}
export function useDocumentContexts(allowed: MaybeRefOrGetter<boolean> = true) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({ queryKey: computed(() => documentKeys.contexts(companyId.value ?? 0)), enabled: computed(() => !!companyId.value && toValue(allowed)), queryFn: ({ queryKey, signal }) => { assertDocumentCompany(companyId.value, queryKey[1]); return $api('/api/v1/documents/contexts', { signal, schema: DocumentContextListSchema }) } })
}
export function useDocumentContextOptions(kind: MaybeRefOrGetter<string | null>, params: MaybeRefOrGetter<DocumentLookupParams> = {}) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({ queryKey: computed(() => documentKeys.contextOptions(companyId.value ?? 0, toValue(kind), toValue(params))), enabled: computed(() => !!companyId.value && !!toValue(kind)), queryFn: ({ queryKey, signal }) => { assertDocumentCompany(companyId.value, queryKey[1]); return $api(`/api/v1/documents/contexts/${encodeURIComponent(queryKey[3]!)}/options`, { query: queryKey[4], signal, schema: DocumentContextOptionListSchema }) } })
}
export function useDocumentTags(params: MaybeRefOrGetter<DocumentLookupParams> = {}) {
  const { $api } = useApi(); const companyId = useDocumentCompany()
  return useQuery({ queryKey: computed(() => documentKeys.tagPage(companyId.value ?? 0, toValue(params))), enabled: computed(() => !!companyId.value), queryFn: ({ queryKey, signal }) => { assertDocumentCompany(companyId.value, queryKey[1]); return $api('/api/v1/documents/tags', { query: queryKey[3], signal, schema: DocumentTagListSchema }) } })
}
export function useCreateDocumentTag() {
  return useCompanyDocumentMutation(
    (api, name: string) => api('/api/v1/documents/tags', { method: 'POST', body: { name }, schema: DocumentTagSchema }),
    async (companyId, client) => client.invalidateQueries({ queryKey: documentKeys.tags(companyId) }),
  )
}
