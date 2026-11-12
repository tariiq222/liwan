<script setup lang="ts">
import type { CustomerCandidate } from '@liwan/contracts'
import { NEW_CUSTOMER } from '@/composables/inbox/inboxCommerce'

// The step a checkout stops at when the contact has no customer yet and customers with its phone exist: the agent uses
// one of them or asks for a new customer, and the checkout is repeated with that answer. Inline under the order
// (SharedInlineConfirm, DESIGN.md section 5), not an overlay.
const props = defineProps<{ candidates: CustomerCandidate[]; pending?: boolean }>()
const emit = defineEmits<{ choose: [choice: string]; cancel: [] }>()
const { t } = useI18n()
const choice = ref<string>()
const items = computed(() => [
  ...props.candidates.map(candidate => ({
    value: String(candidate.id),
    label: candidate.name,
    description: candidate.phone_last4 ? t('inbox.orders.customer.phoneEnds', { last4: candidate.phone_last4 }) : t('inbox.orders.customer.noPhone'),
  })),
  { value: NEW_CUSTOMER, label: t('inbox.orders.customer.new'), description: t('inbox.orders.customer.newHint') },
])
const confirm = () => { if (choice.value) emit('choose', choice.value) }
</script>

<template>
  <SharedInlineConfirm
    color="primary"
    :title="t('inbox.orders.customer.title')"
    :description="t('inbox.orders.customer.description')"
    :confirm-label="t('inbox.orders.customer.confirm')"
    :pending="props.pending"
    :disabled="!choice"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <URadioGroup v-model="choice" class="mt-3" :legend="t('inbox.orders.customer.legend')" :items="items" :disabled="props.pending" data-testid="inbox-order-customer-choice" />
  </SharedInlineConfirm>
</template>
