<script setup lang="ts">
import type { SalesOrder } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'

// The aside of a sales document: who it is for, who sells it, its dates and its terms.
const props = defineProps<{ order: SalesOrder }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel :title="t('sales.record.details')">
    <SharedPropertyRow :label="t('sales.columns.customer')" :value="props.order.customer.name" data-testid="sales-customer" />
    <SharedPropertyRow :label="t('sales.columns.salesperson')" :value="props.order.salesperson?.name ?? t('sales.noSalesperson')" />
    <SharedPropertyRow :label="t('sales.columns.source')" :value="t(`sales.source.${props.order.source}`)" />
    <SharedPropertyRow :label="t('sales.columns.date')"><bdi dir="ltr">{{ formatDate(props.order.date) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('sales.form.validity')">
      <bdi v-if="props.order.validity_date" dir="ltr">{{ formatDate(props.order.validity_date) }}</bdi>
      <template v-else>{{ t('sales.record.noValidity') }}</template>
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('sales.record.currency')" :value="props.order.currency.name" />
  </SharedPropertiesPanel>
  <SharedPropertiesPanel :title="t('sales.form.terms')">
    <p class="whitespace-pre-line text-sm text-default" data-testid="sales-terms">{{ props.order.terms || t('sales.record.noTerms') }}</p>
  </SharedPropertiesPanel>
</template>
