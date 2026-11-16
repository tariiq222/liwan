<script setup lang="ts">
import type { SalesPublicQuotation } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import SalesOrderLinesPanel from './SalesOrderLinesPanel.vue'

// The quotation as its customer reads it: who it is for and its dates, the lines with the totals, and the terms.
const props = defineProps<{ quote: SalesPublicQuotation }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-4" data-testid="quote-document">
    <SharedPropertiesPanel :title="t('sales.quote.details')">
      <SharedPropertyRow :label="t('sales.quote.number')" data-testid="quote-number"><bdi dir="ltr">{{ props.quote.number }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('sales.columns.customer')" :value="props.quote.customer_name" data-testid="quote-customer" />
      <SharedPropertyRow :label="t('sales.columns.date')"><bdi dir="ltr">{{ formatDate(props.quote.date) }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('sales.quote.validUntil')" data-testid="quote-validity">
        <bdi v-if="props.quote.validity_date" dir="ltr">{{ formatDate(props.quote.validity_date) }}</bdi>
        <template v-else>{{ t('sales.record.noValidity') }}</template>
      </SharedPropertyRow>
    </SharedPropertiesPanel>
    <SalesOrderLinesPanel :order="props.quote" />
    <SharedRecordSection v-if="props.quote.terms" variant="panel" :title="t('sales.form.terms')">
      <p class="whitespace-pre-line text-sm text-default" data-testid="quote-terms">{{ props.quote.terms }}</p>
    </SharedRecordSection>
  </div>
</template>
