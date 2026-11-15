import { computed } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SalesPublicQuotationSchema, type SalesQuotationAccept, type SalesQuotationDecline } from '@liwan/contracts'
import { quoteLinkOf, quotePath, type QuoteLink } from './salesQuote'
import { salesKeys } from './salesKeys'

/**
 * The quotation a quote-page address names, read with its access token and no session. A malformed address makes no
 * request (`link` is null). It is not read again on focus: the page shows the answer the customer just gave.
 */
export function useSalesQuotation() {
  const route = useRoute()
  const { $api } = useApi()
  const link = computed(() => quoteLinkOf(route.params.id, route.query.access_token))
  const query = useQuery({
    queryKey: computed(() => salesKeys.quote(link.value?.id ?? 0, link.value?.token ?? '')),
    enabled: computed(() => link.value !== null),
    queryFn: () => $api(quotePath(link.value!), { query: { access_token: link.value!.token }, schema: SalesPublicQuotationSchema }),
    retry: false,
    refetchOnWindowFocus: false,
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
      mutationFn: ({ link, signedBy, signature }: { link: QuoteLink; signedBy?: string; signature?: string }) => post(link, '/accept', { signed_by: signedBy, signature }),
      onSuccess: remember,
    }),
    decline: useMutation({
      mutationFn: ({ link, reason }: { link: QuoteLink; reason?: string }) => post(link, '/decline', { reason }),
      onSuccess: remember,
    }),
  }
}
