import type { QueryClient } from '@tanstack/vue-query'
import type { DocumentDetail } from '@webvue/contracts'
import { documentKeys } from './documentKeys'

/** Equal revisions may carry refreshed permissions; only an older revision is rejected. */
export function preferNewerDocumentRevision<T extends { revision: number }>(previous: T | undefined, incoming: T): T {
  return previous && previous.revision > incoming.revision ? previous : incoming
}
export function replaceDocumentDetail(client: Pick<QueryClient, 'setQueryData'>, companyId: number, document: DocumentDetail) {
  client.setQueryData<DocumentDetail>(documentKeys.detail(companyId, document.id), previous => preferNewerDocumentRevision(previous, document))
}
export function invalidateDocumentLists(client: Pick<QueryClient, 'invalidateQueries'>, companyId: number) {
  return client.invalidateQueries({ queryKey: documentKeys.lists(companyId) })
}
