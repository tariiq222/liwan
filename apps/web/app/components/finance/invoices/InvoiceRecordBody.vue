<script setup lang="ts">
import type { FinanceMoveType } from './invoiceKinds'
import { invoiceDraftFromRecord } from './invoiceLines'
import InvoiceForm from './InvoiceForm.vue'
import FinanceBlockedNotice from '../FinanceBlockedNotice.vue'
import InvoiceLinesPanel from './InvoiceLinesPanel.vue'
import type { InvoiceRecordState } from './useInvoiceRecord'

// The main column of a document's record page: the inline messages and confirmations of its actions, then the lines
// with their totals, or the draft's editor while it is being edited.
defineProps<{ record: InvoiceRecordState; moveType: FinanceMoveType }>()
const { t } = useI18n()
const { can } = useAccess()
</script>

<template>
  <UAlert v-if="record.actionError" role="alert" color="error" variant="subtle" :title="record.actionError" data-testid="finance-invoice-action-error">
    <template v-if="record.zatcaMessages && (record.zatcaMessages.errors.length || record.zatcaMessages.warnings.length)" #description>
      <ul class="list-disc ps-4"><li v-for="(item, index) in [...record.zatcaMessages.errors, ...record.zatcaMessages.warnings]" :key="index"><bdi v-if="item.code">{{ item.code }}</bdi> {{ item.message }}</li></ul>
    </template>
  </UAlert>

  <template v-if="record.invoice && record.actions">
    <UAlert v-if="record.actions.reasons.includes('has_payments')" color="info" variant="subtle" icon="i-lucide-info" :title="t('financeDocuments.record.blockedByPayments')" :description="t('financeDocuments.record.blockedByPaymentsHint')" data-testid="finance-invoice-blocked">
      <template #actions>
        <UButton v-if="record.invoice.partner && can('finance.payments.read')" color="neutral" variant="outline" size="sm" :to="{ path: '/finance/payments', query: { partner_id: String(record.invoice.partner.id) } }" :label="t('financeDocuments.record.viewPayments')" />
      </template>
    </UAlert>

    <FinanceBlockedNotice :reasons="record.actions.reasons.filter(reason => reason !== 'has_payments')" />

    <SharedInlineConfirm v-if="record.confirming === 'delete'" :title="t('financeDocuments.confirm.delete', { name: record.title })" :description="t('financeDocuments.confirm.deleteHint')" :confirm-label="t('financeDocuments.actions.delete')" :pending="record.removing" :disabled="!record.hydrated" color="error" @confirm="record.remove()" @cancel="record.confirming = null" />
    <SharedInlineConfirm v-if="record.confirming === 'cancel'" :title="t('financeDocuments.confirm.cancel', { name: record.title })" :description="t('financeDocuments.confirm.cancelHint')" :confirm-label="t('financeDocuments.actions.cancel')" :pending="record.posting" :disabled="!record.hydrated" color="error" @confirm="record.change('cancel')" @cancel="record.confirming = null" />
    <SharedInlineConfirm v-if="record.confirming === 'reset'" :title="t('financeDocuments.confirm.reset', { name: record.title })" :description="t('financeDocuments.confirm.resetHint')" :confirm-label="t('financeDocuments.actions.resetToDraft')" :pending="record.posting" :disabled="!record.hydrated" color="warning" @confirm="record.change('reset-to-draft')" @cancel="record.confirming = null" />
    <SharedInlineConfirm v-if="record.confirming === 'debit'" :title="t('financeDocuments.confirm.debit', { name: record.title })" :confirm-label="t('financeDocuments.actions.debitNote')" :pending="record.creatingDebitNote" :disabled="!record.hydrated" color="primary" @confirm="record.createDebitNote()" @cancel="record.confirming = null">
      <div class="mt-3 grid gap-3">
        <UFormField :label="t('financeDocuments.confirm.debitReason')" name="finance-debit-reason"><UInput id="finance-debit-reason" v-model="record.debitReason" class="w-full" maxlength="255" /></UFormField>
        <USwitch v-model="record.debitCopyLines" :label="t('financeDocuments.confirm.debitCopyLines')" />
      </div>
    </SharedInlineConfirm>

    <InvoiceForm
      v-if="record.editing && record.actions.can('edit')"
      :move-type="moveType"
      :record-id="record.invoice.id"
      :initial="invoiceDraftFromRecord(record.invoice)"
      :known-partner="record.invoice.partner"
      :back-to="record.backTo"
      @saved="record.editing = false"
      @cancel="record.editing = false"
    />
    <InvoiceLinesPanel v-else :invoice="record.invoice" />
  </template>
</template>
