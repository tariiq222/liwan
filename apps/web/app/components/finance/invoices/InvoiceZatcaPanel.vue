<script setup lang="ts">
import type { FinanceInvoiceZatca } from '@webvue/contracts'
import { ZATCA_STATE_TONE } from './invoiceTones'

// The invoice's ZATCA standing. E-invoicing is sandbox-only in this phase, so the panel says so next to the state.
// Sending is the record page's action: this panel only shows the verdict and ZATCA's own messages.
defineProps<{ zatca: FinanceInvoiceZatca }>()
const { t } = useI18n()
</script>

<template>
  <SharedPropertiesPanel :title="t('financeDocuments.zatca.title')" data-testid="finance-zatca-panel">
    <SharedPropertyRow :label="t('financeDocuments.zatca.state')">
      <span class="flex flex-wrap items-center gap-2">
        <SharedStatusBadge size="sm" :tone="ZATCA_STATE_TONE[zatca.submission.state]" :label="t(`financeDocuments.zatcaStates.${zatca.submission.state}`)" data-testid="finance-zatca-state" />
        <SharedStatusBadge size="sm" tone="info" variant="outline" :label="t('financeDocuments.zatca.sandbox')" data-testid="finance-zatca-sandbox" />
      </span>
    </SharedPropertyRow>
    <SharedPropertyRow v-if="zatca.submission.mode" :label="t('financeDocuments.zatca.mode')" :value="t(`financeDocuments.zatca.modes.${zatca.submission.mode}`)" />
    <SharedPropertyRow v-if="zatca.confirmation_datetime" :label="t('financeDocuments.zatca.confirmedAt')"><bdi class="tabular-nums">{{ zatca.confirmation_datetime }}</bdi></SharedPropertyRow>
    <SharedPropertyRow :label="t('financeDocuments.zatca.qr')" :value="zatca.submission.qr_present ? t('financeDocuments.zatca.qrPresent') : t('financeDocuments.zatca.qrMissing')" />
    <div v-if="zatca.submission.errors.length || zatca.submission.warnings.length" class="grid gap-2 p-(--webvue-card-pad-dense)" data-testid="finance-zatca-messages">
      <UAlert v-if="zatca.submission.errors.length" color="error" variant="subtle" :title="t('financeDocuments.zatca.errors')">
        <template #description><ul class="list-disc ps-4"><li v-for="(item, index) in zatca.submission.errors" :key="index"><bdi v-if="item.code">{{ item.code }}</bdi> {{ item.message }}</li></ul></template>
      </UAlert>
      <UAlert v-if="zatca.submission.warnings.length" color="warning" variant="subtle" :title="t('financeDocuments.zatca.warnings')">
        <template #description><ul class="list-disc ps-4"><li v-for="(item, index) in zatca.submission.warnings" :key="index"><bdi v-if="item.code">{{ item.code }}</bdi> {{ item.message }}</li></ul></template>
      </UAlert>
    </div>
  </SharedPropertiesPanel>
</template>
