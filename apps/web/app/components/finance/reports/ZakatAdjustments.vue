<script setup lang="ts">
import type { FinanceZakatAdjustment } from '@webvue/contracts'
import { useAddZakatAdjustment, useRemoveZakatAdjustment } from '@/composables/finance/useFinanceZakat'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import Money from '../invoices/Money.vue'

// The company's own additions to and deductions from the Zakat base of the year ending on `dateTo` (what the books cannot
// know: a loan taken for the year, an investment, an adjustment the accountant asks for). Each is in the base and the Zakat
// due above; removing one asks first. Whoever may not manage Zakat sees the list and no controls.
const props = defineProps<{ adjustments: readonly FinanceZakatAdjustment[]; dateTo: string; currency: string }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.zakat.manage'))
const add = useAddZakatAdjustment()
const remove = useRemoveZakatAdjustment()
const draft = reactive({ kind: 'add' as 'add' | 'deduct', label: '', amount: '', note: '' })
const attempted = ref(false)
const error = ref('')
const removing = ref<FinanceZakatAdjustment | null>(null)
const kindItems = (['add', 'deduct'] as const).map(value => ({ value, label: t(`financeReports.zakat.kinds.${value}`) }))
const amount = computed(() => draft.amount.trim() === '' ? Number.NaN : Number(draft.amount))
const valid = computed(() => draft.label.trim() !== '' && Number.isFinite(amount.value) && amount.value > 0)

async function submit() {
  if (!hydrated.value || add.isPending.value) return
  attempted.value = true
  error.value = ''
  if (!valid.value) return
  try {
    await add.mutateAsync({ date_to: props.dateTo, kind: draft.kind, label: draft.label.trim(), amount: amount.value, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) })
    Object.assign(draft, { label: '', amount: '', note: '' })
    attempted.value = false
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
async function confirmRemove() {
  const item = removing.value
  if (!item || !hydrated.value || remove.isPending.value) return
  error.value = ''
  try {
    await remove.mutateAsync(item.id)
    removing.value = null
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <section class="grid gap-3 border-t border-default p-(--webvue-card-pad-dense)" data-testid="finance-zakat-adjustments">
    <h3 class="font-semibold text-highlighted">{{ t('financeReports.zakat.adjustmentsTitle') }}</h3>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedInlineConfirm
      v-if="removing"
      :title="t('financeReports.zakat.removeConfirm', { label: removing.label })"
      :description="t('financeReports.zakat.removeHint')"
      :confirm-label="t('financeReports.zakat.remove')"
      color="warning"
      :pending="remove.isPending.value"
      :disabled="!hydrated"
      @confirm="confirmRemove"
      @cancel="removing = null"
    />
    <p v-if="!adjustments.length" class="text-sm text-muted">{{ t('financeReports.zakat.noAdjustments') }}</p>
    <ul v-else class="grid gap-2">
      <li v-for="item in adjustments" :key="item.id" class="flex flex-wrap items-center justify-between gap-2 text-sm" :data-testid="`finance-zakat-adjustment-${item.id}`">
        <span class="flex min-w-0 flex-col">
          <span class="font-medium text-highlighted">{{ item.label }}</span>
          <span v-if="item.note" class="text-xs text-muted">{{ item.note }}</span>
        </span>
        <span class="flex items-center gap-2">
          <SharedStatusBadge size="sm" :tone="item.kind === 'add' ? 'info' : 'neutral'" :label="t(`financeReports.zakat.kinds.${item.kind}`)" />
          <Money :amount="item.kind === 'add' ? item.amount : -item.amount" :currency="currency" />
          <UButton v-if="canManage" color="neutral" variant="ghost" size="sm" icon="i-lucide-trash-2" :disabled="!hydrated || removing !== null" :aria-label="t('financeReports.zakat.removeFor', { label: item.label })" @click="removing = item" />
        </span>
      </li>
    </ul>
    <UForm v-if="canManage" novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-zakat-adjustment-form" @submit="submit">
      <div class="webvue-form-grid">
        <UFormField :label="t('financeReports.zakat.kind')" name="finance-zakat-kind"><USelect id="finance-zakat-kind" v-model="draft.kind" :items="kindItems" class="w-full" :disabled="!hydrated || add.isPending.value" /></UFormField>
        <UFormField :label="t('financeReports.zakat.amount')" name="finance-zakat-amount" required :error="attempted && !(amount > 0) ? t('financeReports.zakat.amountInvalid') : undefined">
          <UInput id="finance-zakat-amount" v-model="draft.amount" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || add.isPending.value" />
        </UFormField>
        <UFormField :label="t('financeReports.zakat.label')" name="finance-zakat-label" required class="sm:col-span-2" :error="attempted && draft.label.trim() === '' ? t('financeReports.zakat.labelRequired') : undefined">
          <UInput id="finance-zakat-label" v-model="draft.label" class="w-full" maxlength="255" :disabled="!hydrated || add.isPending.value" />
        </UFormField>
        <UFormField :label="t('financeReports.zakat.note')" name="finance-zakat-note" class="sm:col-span-2"><UInput id="finance-zakat-note" v-model="draft.note" class="w-full" maxlength="255" :disabled="!hydrated || add.isPending.value" /></UFormField>
      </div>
      <div class="flex justify-end"><UButton type="submit" color="primary" :disabled="!hydrated" :loading="add.isPending.value" :label="t('financeReports.zakat.addAdjustment')" data-testid="finance-zakat-adjustment-submit" /></div>
    </UForm>
  </section>
</template>
