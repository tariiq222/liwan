<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FinanceClosingLine } from '@liwan/contracts'
import { useCloseFiscalYear, useFinanceClosingPreview } from '@/composables/finance/useFinanceClosing'
import Money from '../invoices/Money.vue'
import { blockerText, CLOSING_HASH, CLOSING_PATH, closingErrorMessage } from './closingPresentation'

// The year-end entry a close would post, why it cannot be posted yet, and the irreversible close itself.
const props = defineProps<{ year: number; currency?: string }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const router = useRouter()
// The server closes through the setup elevation too, so both capabilities are needed.
const canClose = computed(() => can('finance.closing.manage') && can('finance.setup.manage'))
const query = useFinanceClosingPreview(() => props.year)
const preview = computed(() => query.data.value)
const blockers = computed(() => preview.value?.blockers ?? [])
// The action stays in view while something blocks the close: its button is disabled and says why, instead of vanishing.
const showAction = computed(() => canClose.value && !!preview.value)
const blocked = computed(() => blockers.value.length > 0)

const confirming = ref(false)
const failure = ref<unknown>(null)
const { mutateAsync: closeYear, isPending: closing } = useCloseFiscalYear()
watch(() => props.year, () => { confirming.value = false; failure.value = null })
const failureMessage = computed(() => failure.value ? closingErrorMessage(failure.value, t) : '')
async function confirmClose() {
  if (!hydrated.value || closing.value || !canClose.value || blocked.value) return
  try {
    await closeYear(props.year)
    await router.replace({ path: CLOSING_PATH, hash: CLOSING_HASH })
  } catch (cause) { failure.value = cause }
}

const numeric = { class: { th: 'text-end', td: 'text-end' } }
const columns = computed<TableColumn<FinanceClosingLine>[]>(() => [
  { id: 'code', header: t('financeGovernance.closing.preview.code') },
  { id: 'name', header: t('financeGovernance.closing.preview.account') },
  { id: 'debit', header: t('financeGovernance.closing.preview.debit'), meta: numeric },
  { id: 'credit', header: t('financeGovernance.closing.preview.credit'), meta: numeric },
])
const resultClass = computed(() => (preview.value?.result ?? 0) < 0 ? 'text-error' : 'text-success')
</script>

<template>
  <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!preview" @retry="query.refetch">
    <div v-if="preview" class="grid gap-(--liwan-gap-card)" data-testid="finance-closing-preview">
      <SharedRecordSection variant="panel" :title="t('financeGovernance.closing.preview.title', { year: preview.year })" :description="t('financeGovernance.closing.preview.hint')">
        <SharedPropertiesPanel>
          <SharedPropertyRow :label="t('financeGovernance.closing.preview.journal')" :value="preview.journal?.name" />
          <SharedPropertyRow :label="t('financeGovernance.closing.preview.retainedEarnings')">
            <bdi v-if="preview.retained_earnings_account">{{ preview.retained_earnings_account.code }} {{ preview.retained_earnings_account.name }}</bdi>
          </SharedPropertyRow>
          <SharedPropertyRow :label="t(preview.result < 0 ? 'financeGovernance.closing.preview.loss' : 'financeGovernance.closing.preview.profit')">
            <Money :class="resultClass" :amount="preview.result" :currency="currency" />
          </SharedPropertyRow>
        </SharedPropertiesPanel>
      </SharedRecordSection>

      <UAlert v-if="blockers.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('financeGovernance.closing.blockers.title')" data-testid="finance-closing-blockers">
        <template #description>
          <ul class="grid gap-1.5">
            <li v-for="blocker in blockers" :key="blocker.code">
              <span class="block font-medium">{{ blockerText(blocker, t) }}</span>
            </li>
          </ul>
        </template>
      </UAlert>

      <SharedRecordSection variant="list" :title="t('financeGovernance.closing.preview.linesTitle')">
        <SharedEmptyState v-if="!preview.lines.length" class="m-(--liwan-card-pad-dense)" :title="t('financeGovernance.closing.preview.noLines')" />
        <template v-else>
          <SharedDataTable bare :rows="preview.lines" :columns="columns" :row-key="line => line.account.id" :caption="t('financeGovernance.closing.preview.linesTitle')">
            <template #code-cell="{ row }"><bdi dir="ltr" class="tabular-nums">{{ row.original.account.code }}</bdi></template>
            <template #name-cell="{ row }">{{ row.original.account.name }}</template>
            <template #debit-cell="{ row }"><Money :amount="row.original.debit" :currency="currency" /></template>
            <template #credit-cell="{ row }"><Money :amount="row.original.credit" :currency="currency" /></template>
            <template #mobile-row="{ row }">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="truncate font-semibold text-highlighted"><bdi dir="ltr" class="tabular-nums">{{ row.account.code }}</bdi> {{ row.account.name }}</span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <span class="text-muted">{{ t('financeGovernance.closing.preview.debit') }}</span><Money :amount="row.debit" :currency="currency" />
                </span>
                <span class="flex items-center justify-between gap-2 text-sm">
                  <span class="text-muted">{{ t('financeGovernance.closing.preview.credit') }}</span><Money :amount="row.credit" :currency="currency" />
                </span>
              </div>
            </template>
          </SharedDataTable>
          <div class="flex items-center justify-between gap-3 border-t border-default p-(--liwan-card-pad-dense) font-semibold" data-testid="finance-closing-totals">
            <span>{{ t('financeGovernance.closing.preview.totals') }}</span>
            <span class="flex flex-wrap items-center gap-x-6 gap-y-1">
              <Money :amount="preview.total_debit" :currency="currency" />
              <Money :amount="preview.total_credit" :currency="currency" />
            </span>
          </div>
        </template>
      </SharedRecordSection>

      <SharedRecordSection v-if="showAction" variant="action" :title="t('financeGovernance.closing.action.title')" :description="t('financeGovernance.closing.action.hint')" data-testid="finance-closing-action">
        <template #actions>
          <UButton color="primary" icon="i-lucide-lock" :disabled="!hydrated || confirming || blocked" :label="t('financeGovernance.closing.action.close')" data-testid="finance-closing-close" @click="confirming = true" />
        </template>
        <p v-if="blocked" class="mb-3 text-sm text-muted" data-testid="finance-closing-blocked-hint">{{ t('financeGovernance.closing.action.blockedHint') }}</p>
        <UAlert v-if="failureMessage" class="mb-3" color="error" variant="subtle" :title="failureMessage" data-testid="finance-closing-error" />
        <SharedInlineConfirm
          v-if="confirming && !blocked"
          color="warning"
          :title="t('financeGovernance.closing.action.confirmTitle', { year: preview.year })"
          :description="t('financeGovernance.closing.action.confirmDescription')"
          :confirm-label="t('financeGovernance.closing.action.close')"
          :pending="closing"
          :disabled="!hydrated"
          @confirm="confirmClose"
          @cancel="confirming = false; failure = null"
        />
      </SharedRecordSection>
    </div>
  </SharedPageState>
</template>
