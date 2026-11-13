<script setup lang="ts">
import type { CustomerCandidate } from '@liwan/contracts'

// The step a create stops at when customers with the same phone exist: the user opens one of them or creates a new
// customer anyway, and the create is repeated with that answer. Inline under the form (SharedInlineConfirm,
// DESIGN.md section 5), not an overlay. The step shows a name and the last four digits only, never a full number.
const props = defineProps<{ candidates: CustomerCandidate[]; pending?: boolean }>()
const emit = defineEmits<{ open: [id: number]; createNew: []; cancel: [] }>()
const { t } = useI18n()
const NEW_CUSTOMER = 'new'
const choice = ref<string>()
const items = computed(() => [
  ...props.candidates.map(candidate => ({
    value: String(candidate.id),
    label: candidate.name,
    description: candidate.phone_last4 ? t('customers.conflict.phoneEnds', { last4: candidate.phone_last4 }) : t('customers.conflict.noPhone'),
  })),
  { value: NEW_CUSTOMER, label: t('customers.conflict.new'), description: t('customers.conflict.newHint') },
])
function choose() {
  if (!choice.value) return
  if (choice.value === NEW_CUSTOMER) emit('createNew')
  else emit('open', Number(choice.value))
}
</script>

<template>
  <SharedInlineConfirm
    color="primary"
    :title="t('customers.conflict.title')"
    :description="t('customers.conflict.description')"
    :confirm-label="t('customers.conflict.confirm')"
    :pending="props.pending"
    :disabled="!choice"
    @confirm="choose"
    @cancel="emit('cancel')"
  >
    <URadioGroup v-model="choice" class="mt-3" :legend="t('customers.conflict.legend')" :items="items" :disabled="props.pending" data-testid="customers-conflict-choice" />
  </SharedInlineConfirm>
</template>
