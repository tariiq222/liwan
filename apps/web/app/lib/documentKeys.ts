export type DocumentListQueryParams = { q?: string; context_kind?: string; context_id?: number; visibility?: 'company' | 'restricted'; expiring_within?: number; expired?: boolean; archived?: boolean; limit?: number; offset?: number }
export type DocumentLookupParams = { q?: string; limit?: number; offset?: number; id?: number }
export const documentKeys = {
  lists: (companyId: number) => ['documents', companyId, 'list'] as const,
  list: (companyId: number, params: DocumentListQueryParams) => ['documents', companyId, 'list', params] as const,
  detail: (companyId: number, id: number) => ['documents', companyId, 'detail', id] as const,
  files: (companyId: number, id: number) => ['documents', companyId, 'files', id] as const,
  filePage: (companyId: number, id: number, revision: number, params: DocumentListQueryParams) => ['documents', companyId, 'files', id, revision, params] as const,
  access: (companyId: number, id: number) => ['documents', companyId, 'access', id] as const,
  contexts: (companyId: number) => ['documents', companyId, 'contexts'] as const,
  contextOptions: (companyId: number, kind: string | null, params: DocumentLookupParams = {}) => ['documents', companyId, 'context-options', kind, params] as const,
  tagPage: (companyId: number, params: DocumentLookupParams) => ['documents', companyId, 'tags', params] as const,
  tags: (companyId: number) => ['documents', companyId, 'tags'] as const,
}

export const DOCUMENT_EXPIRING_DAYS = 30

export function documentCommittedListParams(query: Record<string, unknown>): Pick<DocumentListQueryParams, 'q' | 'offset' | 'visibility' | 'expiring_within' | 'expired'> & { q: string; offset: number } {
  const days = Number(query.expiring_within)
  return {
    q: typeof query.q === 'string' ? query.q.trim() : '',
    offset: Math.max(0, Number(query.offset ?? 0) || 0),
    visibility: query.visibility === 'company' || query.visibility === 'restricted' ? query.visibility : undefined,
    // The filter offers one window, so any valid window in the URL reads as that window.
    expiring_within: Number.isInteger(days) && days >= 1 && days <= 365 ? DOCUMENT_EXPIRING_DAYS : undefined,
    expired: query.expired === '1' ? true : undefined,
  }
}
export function hasPendingDocumentSearch(search: string, committed: unknown) { return search.trim() !== (typeof committed === 'string' ? committed.trim() : '') }
