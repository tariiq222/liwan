<script setup lang="ts">
import type { SalesPublicQuotation } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { quoteView, type QuoteView } from '@/composables/sales/salesQuote'

// What became of a quotation the customer cannot answer now: they accepted or declined it, the sender confirmed or
// cancelled it, it expired, or the sender did not offer an online answer. An open quotation shows `SalesQuoteAnswer`.
const props = defineProps<{ quote: SalesPublicQuotation }>()
const { t } = useI18n()

const STATUS: Record<Exclude<QuoteView, 'open'>, { color: 'success' | 'neutral' | 'warning' | 'info'; icon: string }> = {
  accepted: { color: 'success', icon: 'i-lucide-circle-check' },
  declined: { color: 'neutral', icon: 'i-lucide-circle-x' },
  confirmed: { color: 'success', icon: 'i-lucide-circle-check' },
  cancelled: { color: 'neutral', icon: 'i-lucide-ban' },
  expired: { color: 'warning', icon: 'i-lucide-clock' },
  notOffered: { color: 'info', icon: 'i-lucide-info' },
}
const view = computed(() => quoteView(props.quote))
const status = computed(() => (view.value === 'open' ? null : STATUS[view.value]))
// An accepted quotation the sender's setting already turned into an order says so.
const key = computed(() => (view.value === 'accepted' && props.quote.state === 'confirmed' ? 'acceptedConfirmed' : view.value))
const answeredOn = computed(() => (props.quote.answered_at ? formatDate(props.quote.answered_at) : null))
</script>

<template>
  <UAlert v-if="status" role="status" :color="status.color" variant="subtle" :icon="status.icon" :title="t(`sales.quote.states.${key}.title`)" :data-testid="`quote-${view}`">
    <template #description>
      <p>{{ t(`sales.quote.states.${key}.body`) }}</p>
      <p v-if="props.quote.signed_by" data-testid="quote-signed-by">{{ t('sales.quote.signedBy', { name: props.quote.signed_by }) }}</p>
      <p v-if="answeredOn" data-testid="quote-answered-at">{{ t('sales.quote.answeredOn', { date: answeredOn }) }}</p>
    </template>
  </UAlert>
</template>
