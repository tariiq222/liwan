import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { PaymentLinkSchema } from '@webvue/contracts'
import { ApiError } from './useApi'
import { canReach } from '@/utils/accessPolicy'
import { canUse, hasFeature } from '@/modules/registry'
import { canOfferPaymentLink, paymentLinkErrorKey, paymentLinkUrl, type PaymentLinkInvoice } from './paymentLinks'

const LINKS_MANAGE = 'payments.links.manage'
const PAYMENTS_FEATURE = 'payments.enabled'

/** Create the link a customer pays an invoice by. The same invoice always answers its same link. */
export function useCreatePaymentLink() {
  const { $api } = useApi()
  return useMutation({
    mutationFn: (invoiceId: number) =>
      $api('/api/v1/payments/links', { method: 'POST', body: { invoice_id: invoiceId }, schema: PaymentLinkSchema }),
  })
}

/**
 * The "payment link" action of a customer invoice's page: offered to a user who holds `payments.links.manage` (with the
 * payments feature on) while the invoice can still be paid; running it copies the link to the clipboard and says so.
 */
export function usePaymentLinkAction(invoice: MaybeRefOrGetter<PaymentLinkInvoice | null | undefined>) {
  const { t } = useI18n()
  const toast = useToast()
  const { me } = useMe()
  const create = useCreatePaymentLink()
  // Creating a link writes (it may mint the invoice's token): it needs the capability usable for
  // writing and the payments feature open for writing, as the server checks.
  const offered = computed(() => {
    const identity = me.value
    return canReach(identity, LINKS_MANAGE) && canUse(identity, LINKS_MANAGE, true)
      && hasFeature(identity, PAYMENTS_FEATURE, true) && canOfferPaymentLink(toValue(invoice))
  })

  function failureText(error: unknown): string {
    const key = paymentLinkErrorKey(error)
    if (key) return t(key)
    return error instanceof ApiError ? error.message : t('errors.generic')
  }

  async function copyLink() {
    const target = toValue(invoice)
    if (!target || create.isPending.value) return
    let url: string
    try {
      url = paymentLinkUrl(window.location.origin, (await create.mutateAsync(target.id)).path)
    } catch (error) {
      toast.add({ title: t('payments.link.failed'), description: failureText(error), color: 'error' })
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.add({ title: t('payments.link.copied'), description: t('payments.link.copiedHint'), color: 'success' })
    } catch {
      // The link exists but the browser refused the clipboard (an insecure page, a denied permission): show it so it can be copied by hand.
      toast.add({ title: t('payments.link.copyFailed'), description: url, color: 'warning', duration: 0 })
    }
  }

  return { offered, pending: create.isPending, copyLink }
}
