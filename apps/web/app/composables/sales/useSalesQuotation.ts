import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesPublicQuotationSchema, type SalesQuotationAccept, type SalesSignatureMethod, type SalesQuotationDecline } from '@liwan/contracts'
import { quoteLinkOf, quotePath, type QuoteLink } from './salesQuote'
import { salesKeys } from './salesKeys'

/** How often a quotation whose payment is on its way (processing, or received and not yet confirmed) is read again, and for how long. */
export const PROCESSING_REFETCH_MS = 8_000
export const PROCESSING_REFETCH_LIMIT_MS = 5 * 60_000

/**
 * The quotation a quote-page address names, read with its access token and no session. A malformed address makes no
 * request (`link` is null). It is not read again on focus: the page shows the answer the customer just gave. While its
 * payment is processing or received it is read again every few seconds, for a few minutes, so the page learns the payment landed or the order was confirmed.
 */
export function useSalesQuotation() {
  const route = useRoute()
  const { $api } = useApi()
  const link = computed(() => quoteLinkOf(route.params.id, route.query.access_token))
  let processingSince: number | null = null
  const query = useQuery({
    queryKey: computed(() => salesKeys.quote(link.value?.id ?? 0, link.value?.token ?? '')),
    enabled: computed(() => link.value !== null),
    queryFn: () => $api(quotePath(link.value!), { query: { access_token: link.value!.token }, schema: SalesPublicQuotationSchema }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: query => {
      const state = query.state.data?.payment?.state
      if (state !== 'processing' && state !== 'received') {
        processingSince = null
        return false
      }
      processingSince ??= Date.now()
      return Date.now() - processingSince < PROCESSING_REFETCH_LIMIT_MS ? PROCESSING_REFETCH_MS : false
    },
  })
  return { link, ...query }
}

/** The two answers of the customer. Each returns the quotation as it now stands, which replaces the cached one. */
export function useSalesQuotationAnswer() {
  const { $api } = useApi()
  const client = useQueryClient()
  const remember = (quotation: { id: number }, { link }: { link: QuoteLink }) => client.setQueryData(salesKeys.quote(quotation.id, link.token), quotation)
  const post = (link: QuoteLink, action: string, body: Omit<SalesQuotationAccept, 'access_token'> | Omit<SalesQuotationDecline, 'access_token'>) =>
    $api(quotePath(link, action), { method: 'POST', body: { access_token: link.token, ...body }, schema: SalesPublicQuotationSchema })
  return {
    accept: useMutation({
      mutationFn: ({ link, signedBy, signature, signatureMethod }: { link: QuoteLink; signedBy?: string; signature?: string; signatureMethod?: SalesSignatureMethod }) => post(link, '/accept', { signed_by: signedBy, signature, signature_method: signatureMethod }),
      onSuccess: remember,
    }),
    decline: useMutation({
      mutationFn: ({ link, reason }: { link: QuoteLink; reason?: string }) => post(link, '/decline', { reason }),
      onSuccess: remember,
    }),
  }
}
