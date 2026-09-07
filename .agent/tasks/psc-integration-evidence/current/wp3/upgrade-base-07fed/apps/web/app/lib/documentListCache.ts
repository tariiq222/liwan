import type { QueryClient } from '@tanstack/vue-query'
import type { HrDocument } from '@nasq/contracts'

export type DocumentListQueryParams = {
  q?: string
  department_id?: number
  limit?: number
  offset?: number
}

export const documentListQueryKey = (params: DocumentListQueryParams) => ['hr', 'documents', params] as const

export const documentListQueryPrefix = ['hr', 'documents'] as const

export function replaceDocumentDetail(client: Pick<QueryClient, 'setQueryData'>, document: HrDocument) {
  client.setQueryData(['hr', 'document', document.id], document)
}

export function invalidateDocumentLists(client: Pick<QueryClient, 'invalidateQueries'>) {
  return client.invalidateQueries({ queryKey: documentListQueryPrefix })
}
