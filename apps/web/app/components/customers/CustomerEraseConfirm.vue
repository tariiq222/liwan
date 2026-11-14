<script setup lang="ts">
import { CUSTOMER_PRIVACY_REASON_MAX } from '@liwan/contracts'

// The last step of an erase, inline under the review (SharedInlineConfirm, DESIGN.md section 5): the reason and the
// customer's name typed exactly. The button stays off until the name matches; the server compares it again.
const props = defineProps<{ customerName: string; pending?: boolean; nameRefused?: boolean; reasonRefused?: boolean }>()
const emit = defineEmits<{ confirm: [value: { reason: string; confirmation: string }]; cancel: [] }>()
const { t } = useI18n()
const reason = ref('')
const confirmation = ref('')
const reasonText = computed(() => reason.value.trim())
const nameMatches = computed(() => confirmation.value === props.customerName)
// A name still being typed is not an error: the mismatch shows once the typed text is as long as the name.
const nameError = computed(() => props.nameRefused || (confirmation.value.length >= props.customerName.length && !nameMatches.value)
  ? t('customers.privacy.erase.confirm.nameWrong', { name: props.customerName })
  : undefined)
const reasonError = computed(() => props.reasonRefused ? t('customers.privacy.reasonRefused', { max: CUSTOMER_PRIVACY_REASON_MAX }) : undefined)
function submit() {
  if (!nameMatches.value || !reasonText.value) return
  emit('confirm', { reason: reasonText.value, confirmation: confirmation.value })
}
</script>

<template>
  <SharedInlineConfirm
    :title="t('customers.privacy.erase.confirm.title')"
    :description="t('customers.privacy.erase.confirm.description')"
    :confirm-label="t('customers.privacy.erase.confirm.action')"
    :cancel-label="t('customers.privacy.erase.confirm.cancel')"
    :pending="props.pending"
    :disabled="!nameMatches || !reasonText"
    @confirm="submit"
    @cancel="emit('cancel')"
  >
    <div class="mt-3 space-y-3">
      <UFormField :label="t('customers.privacy.reasonLabel')" :hint="t('customers.privacy.reasonHint', { max: CUSTOMER_PRIVACY_REASON_MAX })" :error="reasonError" required>
        <UTextarea v-model="reason" class="w-full" :rows="2" :maxlength="CUSTOMER_PRIVACY_REASON_MAX" :disabled="props.pending" data-testid="customer-erase-reason" />
      </UFormField>
      <UFormField :label="t('customers.privacy.erase.confirm.nameLabel')" :hint="t('customers.privacy.erase.confirm.nameHint', { name: props.customerName })" :error="nameError" required>
        <UInput v-model="confirmation" class="w-full" autocomplete="off" :disabled="props.pending" data-testid="customer-erase-name" />
      </UFormField>
    </div>
  </SharedInlineConfirm>
</template>
