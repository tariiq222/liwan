import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { PayableInvoiceSchema, PaymentRedirectSchema, type PaymentOption } from '@webvue/contracts'
import { PAY_POLL_WINDOW_MS, payLinkOf, pollDelay, startBody, type PayLink } from './paymentPay'

export const payableInvoiceKeys = {
  record: (link: PayLink | null) => ['payments', 'pay', link?.id ?? 0, link?.token ?? ''] as const,
}

/**
 * The invoice a pay-page address names, read with its access token and no session. A malformed address makes no request
 * (`link` is null). With `settle`, the invoice is re-read every few seconds for one minute while its payment is still being
 * confirmed (the status page); `windowOpen` says whether that minute is still running.
 */
export function usePayableInvoice(options: { settle?: boolean } = {}) {
  const route = useRoute()
  const { $api } = useApi()
  const link = computed(() => payLinkOf(route.params.id, route.query.access_token))
  const windowOpen = ref(options.settle === true)
  let closing: ReturnType<typeof setTimeout> | undefined
  if (options.settle) {
    onMounted(() => { closing = setTimeout(() => { windowOpen.value = false }, PAY_POLL_WINDOW_MS) })
    onBeforeUnmount(() => clearTimeout(closing))
  }
  const query = useQuery({
    queryKey: computed(() => payableInvoiceKeys.record(link.value)),
    enabled: computed(() => link.value !== null),
    queryFn: () => $api(`/api/v1/public/payments/invoices/${link.value!.id}`, { query: { access_token: link.value!.token }, schema: PayableInvoiceSchema }),
    retry: false,
    refetchInterval: current => pollDelay(current.state.data?.status, windowOpen.value),
  })
  return { link, windowOpen, ...query }
}

/** Start a payment: the answer is the gateway page to open. A start never retries on its own. */
export function useStartPayment() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ link, option }: { link: PayLink; option: PaymentOption }) =>
      $api(`/api/v1/public/payments/invoices/${link.id}/transactions`, { method: 'POST', body: startBody(link, option), schema: PaymentRedirectSchema }),
  })
}
