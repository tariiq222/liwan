<script setup lang="ts">
import SalesQuoteAnswer from '@/components/sales/SalesQuoteAnswer.vue'
import SalesQuoteDocument from '@/components/sales/SalesQuoteDocument.vue'
import SalesQuoteHeader from '@/components/sales/SalesQuoteHeader.vue'
import SalesQuoteStatus from '@/components/sales/SalesQuoteStatus.vue'
import { isInvalidQuoteLink, quoteAnswerErrorKey, quoteChanged, quotePdfHref, quoteView } from '@/composables/sales/salesQuote'
import { useSalesQuotation, useSalesQuotationAnswer } from '@/composables/sales/useSalesQuotation'

// The public page a customer opens from the link of a quotation they were sent: no account, no session. The access token
// in the address is the only credential. They read the quotation, download it as a PDF, and, when the sender allows it,
// accept it (with a signature when asked) or decline it.
definePageMeta({ layout: false, access: 'public' })

const { t } = useI18n()
const { link, data: quote, error, isLoading, isError, refetch } = useSalesQuotation()
const answers = useSalesQuotationAnswer()

const invalidLink = computed(() => !link.value || isInvalidQuoteLink(error.value))
const open = computed(() => quote.value !== undefined && quoteView(quote.value) === 'open')
const pending = computed(() => {
  if (answers.accept.isPending.value) return 'accept'
  return answers.decline.isPending.value ? 'decline' : null
})
const actionError = ref<string | null>(null)

async function answer(call: () => Promise<unknown>) {
  if (!link.value || pending.value) return
  actionError.value = null
  try {
    await call()
  } catch (cause) {
    actionError.value = t(quoteAnswerErrorKey(cause))
    // The quotation may have been answered, confirmed or expired meanwhile: read it again so the page tells the truth.
    if (quoteChanged(cause)) await refetch()
  }
}
const accept = (body: { signedBy?: string; signature?: string }) => answer(() => answers.accept.mutateAsync({ link: link.value!, ...body }))
const decline = (reason: string | undefined) => answer(() => answers.decline.mutateAsync({ link: link.value!, reason }))
</script>

<template>
  <main class="min-h-svh bg-default p-4 md:p-10">
    <SharedStandalonePage variant="print">
      <SalesQuoteHeader :title="quote ? t('sales.quote.title', { number: quote.number }) : t('sales.quote.heading')" :company="quote?.company_name ?? null" />
      <UAlert v-if="invalidLink" role="alert" color="error" variant="subtle" icon="i-lucide-link-2-off" :title="t('sales.quote.states.invalidLink.title')" :description="t('sales.quote.states.invalidLink.body')" data-testid="quote-invalid" />
      <div v-else-if="quote && link" class="grid gap-4">
        <SalesQuoteStatus v-if="!open" :quote="quote" />
        <SalesQuoteDocument :quote="quote" />
        <div class="liwan-print-hide flex justify-end">
          <UButton color="neutral" variant="outline" icon="i-lucide-download" :href="quotePdfHref(link)" external :label="t('sales.quote.pdf')" data-testid="quote-pdf" />
        </div>
        <SalesQuoteAnswer v-if="open" class="liwan-print-hide" :quote="quote" :pending="pending" :error="actionError" @accept="accept" @decline="decline" />
      </div>
      <div v-else-if="isError" class="grid gap-4">
        <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-cloud-off" :title="t('sales.quote.states.unavailable.title')" :description="t('sales.quote.states.unavailable.body')" data-testid="quote-unavailable" />
        <UButton color="neutral" variant="outline" class="w-full justify-center" icon="i-lucide-refresh-cw" :label="t('sales.quote.retry')" @click="() => refetch()" />
      </div>
      <SharedLoadingSkeleton v-else-if="isLoading" />
    </SharedStandalonePage>
  </main>
</template>
