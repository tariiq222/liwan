<script setup lang="ts">
import { CUSTOMER_PRIVACY_REASON_MAX } from '@liwan/contracts'

// The export of one customer's personal data: the reason is asked first and kept in the privacy log, then the
// spreadsheet downloads. A refused reason or a failed download shows under the field and the page stays as it was.
const props = defineProps<{ pending?: boolean; failed?: boolean; reasonRefused?: boolean }>()
const emit = defineEmits<{ submit: [reason: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const reason = ref('')
const reasonText = computed(() => reason.value.trim())
const reasonError = computed(() => props.reasonRefused ? t('customers.privacy.reasonRefused', { max: CUSTOMER_PRIVACY_REASON_MAX }) : undefined)
function submit() {
  if (!hydrated.value || props.pending || !reasonText.value) return
  emit('submit', reasonText.value)
}
</script>

<template>
  <SharedFormSection :title="t('customers.privacy.export.title')" :description="t('customers.privacy.export.description')" panel>
    <form class="space-y-3" data-testid="customer-privacy-export" @submit.prevent="submit">
      <UFormField :label="t('customers.privacy.reasonLabel')" :hint="t('customers.privacy.reasonHint', { max: CUSTOMER_PRIVACY_REASON_MAX })" :error="reasonError" required>
        <UTextarea v-model="reason" class="w-full" :rows="2" :maxlength="CUSTOMER_PRIVACY_REASON_MAX" :disabled="props.pending" data-testid="customer-privacy-export-reason" />
      </UFormField>
      <UAlert v-if="props.failed" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('customers.privacy.export.failed')" role="alert" />
      <SharedFormActions>
        <UButton type="submit" icon="i-lucide-download" :disabled="!hydrated || !reasonText" :loading="props.pending" :label="props.pending ? t('customers.privacy.export.exporting') : t('customers.privacy.export.action')" data-testid="customer-privacy-export-submit" />
      </SharedFormActions>
    </form>
  </SharedFormSection>
</template>
