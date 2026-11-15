<script setup lang="ts">
import { SALES_LIMITS, type SalesPublicQuotation } from '@liwan/contracts'
import { signatureFits } from '@/composables/sales/salesQuote'
import SalesSignaturePad from './SalesSignaturePad.vue'

// The answer of the customer to an open quotation: accept it (with a name and a drawn signature when the sender asked
// for one) or decline it with an optional reason behind an inline confirmation. The page sends the answer; this only
// collects it.
const props = defineProps<{ quote: SalesPublicQuotation; pending: 'accept' | 'decline' | null; error: string | null }>()
const emit = defineEmits<{ accept: [answer: { signedBy?: string; signature?: string }]; decline: [reason: string | undefined] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const signing = computed(() => props.quote.answer_mode === 'accept_and_sign')
const signedBy = ref('')
const signature = ref<string | null>(null)
const attempted = ref(false)
const nameError = computed(() => (attempted.value && !signedBy.value.trim() ? t('sales.quote.signedByRequired') : undefined))
const signatureError = computed(() => {
  if (!attempted.value) return undefined
  if (!signature.value) return t('sales.quote.signatureRequired')
  return signatureFits(signature.value) ? undefined : t('sales.quote.signatureTooLarge')
})
const busy = computed(() => !hydrated.value || props.pending !== null)

function accept() {
  if (busy.value) return
  if (!signing.value) return emit('accept', {})
  attempted.value = true
  if (nameError.value || signatureError.value || !signature.value) return
  emit('accept', { signedBy: signedBy.value.trim(), signature: signature.value })
}

const declining = ref(false)
const reason = ref('')
function decline() {
  const text = reason.value.trim()
  emit('decline', text || undefined)
}
</script>

<template>
  <SharedRecordSection variant="action" :title="t('sales.quote.answerTitle')" data-testid="quote-answer">
    <form class="grid gap-4" novalidate @submit.prevent="accept">
      <template v-if="props.quote.can_accept && signing">
        <UFormField :label="t('sales.quote.signedByLabel')" :error="nameError" required>
          <UInput v-model="signedBy" class="w-full" autocomplete="name" :maxlength="SALES_LIMITS.signedBy" :disabled="busy" data-testid="quote-signed-by-input" />
        </UFormField>
        <UFormField :label="t('sales.quote.signature')" :error="signatureError" required>
          <SalesSignaturePad v-model="signature" :signer-name="signedBy" :disabled="busy" />
        </UFormField>
      </template>
      <UAlert v-if="props.error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="props.error" data-testid="quote-action-error" />
      <div v-if="!declining" class="flex flex-wrap gap-2">
        <UButton v-if="props.quote.can_accept" type="submit" size="lg" icon="i-lucide-check" :loading="props.pending === 'accept'" :disabled="busy" :label="t(signing ? 'sales.quote.acceptAndSign' : 'sales.quote.accept')" data-testid="quote-accept" />
        <UButton v-if="props.quote.can_decline" type="button" size="lg" color="error" variant="outline" icon="i-lucide-x" :disabled="busy" :label="t('sales.quote.decline')" data-testid="quote-decline" @click="declining = true" />
      </div>
    </form>
    <SharedInlineConfirm
      v-if="declining"
      class="mt-4"
      :title="t('sales.quote.declineTitle')"
      :description="t('sales.quote.declineHint')"
      :confirm-label="t('sales.quote.declineConfirm')"
      :cancel-label="t('sales.quote.declineKeep')"
      :pending="props.pending === 'decline'"
      @cancel="declining = false"
      @confirm="decline"
    >
      <UFormField :label="t('sales.quote.declineReason')">
        <UTextarea v-model="reason" class="w-full" :rows="3" :maxlength="SALES_LIMITS.declineReason" :disabled="props.pending !== null" data-testid="quote-decline-reason" />
      </UFormField>
    </SharedInlineConfirm>
  </SharedRecordSection>
</template>
