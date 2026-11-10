<script setup lang="ts">
import type { FinanceInvoiceZatca } from '@liwan/contracts'
import { useNow } from '@vueuse/core'
import { ZATCA_STATE_TONE } from './invoiceTones'
import { zatcaRetryWaitSeconds } from './zatcaRetryWait'

// The invoice's ZATCA standing. E-invoicing is sandbox-only in this phase, so the panel says so next to the state.
// Sending is the record page's action: this panel only shows the verdict and ZATCA's own messages.
// A failed document can be sent again by hand; the server counts the retries and spaces them, so the panel says how many were made and when the next is allowed.
const props = defineProps<{ zatca: FinanceInvoiceZatca }>()
const { t, locale } = useI18n()
const clock = useNow({ interval: 1000 })
const resendable = computed(() => !['accepted', 'not_applicable'].includes(props.zatca.submission.state))
const waiting = computed(() => zatcaRetryWaitSeconds(props.zatca.submission, clock.value.getTime()) > 0)
const nextTime = computed(() => props.zatca.submission.next_retry_at
  ? new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(props.zatca.submission.next_retry_at))
  : '')
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
    <SharedPropertyRow v-if="resendable" :label="t('financeDocuments.zatca.retries')" data-testid="finance-zatca-retries">
      <bdi class="tabular-nums">{{ zatca.submission.retry_count }}</bdi>
      <span v-if="zatca.submission.next_retry_at" class="block text-xs text-muted" data-testid="finance-zatca-retry-hint">{{ waiting ? t('financeDocuments.zatca.retryAt', { time: nextTime }) : t('financeDocuments.zatca.retryNow') }}</span>
    </SharedPropertyRow>
    <SharedPropertyRow :label="t('financeDocuments.zatca.qr')" :value="zatca.submission.qr_present ? t('financeDocuments.zatca.qrPresent') : t('financeDocuments.zatca.qrMissing')" />
    <div v-if="zatca.submission.errors.length || zatca.submission.warnings.length" class="grid gap-2 p-(--liwan-card-pad-dense)" data-testid="finance-zatca-messages">
      <UAlert v-if="zatca.submission.errors.length" color="error" variant="subtle" :title="t('financeDocuments.zatca.errors')">
        <template #description><ul class="list-disc ps-4"><li v-for="(item, index) in zatca.submission.errors" :key="index"><bdi v-if="item.code">{{ item.code }}</bdi> {{ item.message }}</li></ul></template>
      </UAlert>
      <UAlert v-if="zatca.submission.warnings.length" color="warning" variant="subtle" :title="t('financeDocuments.zatca.warnings')">
        <template #description><ul class="list-disc ps-4"><li v-for="(item, index) in zatca.submission.warnings" :key="index"><bdi v-if="item.code">{{ item.code }}</bdi> {{ item.message }}</li></ul></template>
      </UAlert>
    </div>
  </SharedPropertiesPanel>
</template>
