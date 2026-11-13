<script setup lang="ts">
import type { CustomerFieldRemovalDetails } from '@liwan/contracts'

// Asked before a write that removes customer fields still holding values: it names each field and how many customers
// lose a value, and the write is repeated only on confirm. Inline, not an overlay (DESIGN.md section 5).
defineProps<{ fields: CustomerFieldRemovalDetails['fields']; pending?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t, n } = useI18n()
</script>

<template>
  <SharedInlineConfirm
    :title="t('customers.settings.fields.removeTitle')"
    :description="t('customers.settings.fields.removeHint')"
    :confirm-label="t('customers.settings.fields.removeConfirm')"
    :pending="pending"
    data-testid="customers-field-removal"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <ul class="mt-2 list-disc ps-5">
      <li v-for="field in fields" :key="field.key">{{ t('customers.settings.fields.removeRow', { label: field.label, count: n(field.count) }, field.count) }}</li>
    </ul>
  </SharedInlineConfirm>
</template>
