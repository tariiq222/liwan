<script setup lang="ts">
import type { CustomerFieldRemovalDetails } from '@liwan/contracts'
import { customerRemovalKind } from '@/composables/customers/customerErrors'

// Asked before a write that removes customer fields, or options of a field, still held by customers: it names each
// field and each option with how many customers lose a value, and the write is repeated only on confirm. Inline, not
// an overlay (DESIGN.md section 5).
const props = defineProps<{ removal: CustomerFieldRemovalDetails; pending?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t, n } = useI18n()
const prefix = computed(() => `customers.settings.fields.removal.${customerRemovalKind(props.removal)}`)
</script>

<template>
  <SharedInlineConfirm
    :title="t(`${prefix}.title`)"
    :description="t(`${prefix}.hint`)"
    :confirm-label="t(`${prefix}.confirm`)"
    :pending="pending"
    data-testid="customers-field-removal"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <ul class="mt-2 list-disc ps-5">
      <li v-for="field in removal.fields" :key="field.key">{{ t('customers.settings.fields.removal.fieldRow', { label: field.label, count: n(field.count) }, field.count) }}</li>
      <li v-for="option in removal.options" :key="`${option.field_key}/${option.key}`">{{ t('customers.settings.fields.removal.optionRow', { option: option.label, field: option.field_label, count: n(option.count) }, option.count) }}</li>
    </ul>
  </SharedInlineConfirm>
</template>
