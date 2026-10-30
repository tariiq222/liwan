import { OperationRequestListSchema } from '@liwan/contracts'
import { ATTENTION_ROWS_PER_PROVIDER } from '../../composables/nav/attentionModel'
import type { AppAttentionProvider } from '../types'

/** Requests waiting for my review: the same list as «بانتظار موافقتي», which the server limits to what I can review. */
export const pendingReviewAttention: AppAttentionProvider = {
  id: 'operations-pending',
  module: 'operations',
  work: 'decide',
  capability: 'operations.requests.review',
  queryKey: ['operations', 'requests', 'list', 'attention', 'pending'],
  async load(api, t) {
    const page = await api('/api/v1/operations/requests', { query: { scope: 'pending', limit: ATTENTION_ROWS_PER_PROVIDER }, schema: OperationRequestListSchema })
    return page.items.slice(0, ATTENTION_ROWS_PER_PROVIDER).map(request => ({
      id: `operation-${request.id}`,
      label: request.name,
      to: `/operations/${request.id}`,
      caption: t('operations.attention.from', { name: request.requester.name }),
      tone: 'urgent' as const,
    }))
  },
}
