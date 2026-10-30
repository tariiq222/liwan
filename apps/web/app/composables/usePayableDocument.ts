import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { ZodType } from 'zod'
import { PayableInvoiceSchema, PayableOrderSchema, PaymentRedirectSchema, type PayDocumentKind, type PaymentOption } from '@liwan/contracts'
import { PAY_POLL_WINDOW_MS, payKindOf, payLinkOf, pollDelay, startBody, type PayableDocument, type PayLink } from './paymentPay'

/** Where each kind of document lives under the public payments namespace, and the contract its read answers with. */
const DOCUMENTS: Readonly<Record<PayDocumentKind, { segment: string; schema: ZodType<PayableDocument> }>> = {
  invoice: { segment: 'invoices', schema: PayableInvoiceSchema },
  order: { segment: 'orders', schema: PayableOrderSchema },
}

const documentPath = (link: PayLink) => `/api/v1/public/payments/${DOCUMENTS[link.kind].segment}/${link.id}`

export const payableDocumentKeys = {
  record: (link: PayLink | null) => ['payments', 'pay', link?.kind ?? '', link?.id ?? 0, link?.token ?? ''] as const,
}

/**
 * The invoice or order a pay-page address names, read with its access token and no session. A malformed address makes no
 * request (`link` is null; `kind` is still the address's kind when it names a known one). With `settle`, the document is
 * re-read every few seconds for one minute while its payment is still being confirmed (the status page); `windowOpen` says
 * whether that minute is still running.
 */
export function usePayableDocument(options: { settle?: boolean } = {}) {
  const route = useRoute()
  const { $api } = useApi()
  const kind = computed(() => payKindOf(route.params.kind))
  const link = computed(() => payLinkOf(route.params.kind, route.params.id, route.query.access_token))
  const windowOpen = ref(options.settle === true)
  let closing: ReturnType<typeof setTimeout> | undefined
  if (options.settle) {
    onMounted(() => { closing = setTimeout(() => { windowOpen.value = false }, PAY_POLL_WINDOW_MS) })
    onBeforeUnmount(() => clearTimeout(closing))
  }
  const query = useQuery({
    queryKey: computed(() => payableDocumentKeys.record(link.value)),
    enabled: computed(() => link.value !== null),
    queryFn: () => $api(documentPath(link.value!), { query: { access_token: link.value!.token }, schema: DOCUMENTS[link.value!.kind].schema }),
    retry: false,
    refetchInterval: current => pollDelay(current.state.data?.status, windowOpen.value),
  })
  return { kind, link, windowOpen, ...query }
}

/** Start a payment: the answer is the gateway page to open. A start never retries on its own. */
export function useStartPayment() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ link, option }: { link: PayLink; option: PaymentOption }) =>
      $api(`${documentPath(link)}/transactions`, { method: 'POST', body: startBody(link, option), schema: PaymentRedirectSchema }),
  })
}
