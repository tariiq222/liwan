<script setup lang="ts">
import type { FinanceBankAutoReconcile } from '@liwan/contracts'
import { useAutoReconcileFinanceBankStatement } from '@/composables/finance/useFinanceBank'
import { financeErrorMessage } from '../financeErrors'
import { bankErrorKey } from './bankErrors'

// Matches a statement's open lines that have exactly one certain item. The first press only reports what would happen;
// writing needs the second, explicit one. Ambiguous and unmatched lines are left to a person, never guessed.
const props = defineProps<{ statementId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const call = useAutoReconcileFinanceBankStatement()
const result = ref<FinanceBankAutoReconcile | null>(null)
const error = ref('')

async function run(apply: boolean) {
  if (!hydrated.value || call.isPending.value) return
  error.value = ''
  try {
    result.value = await call.mutateAsync({ id: props.statementId, apply })
  } catch (cause) {
    error.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
const failed = computed(() => result.value?.review.filter(item => item.reason === 'failed') ?? [])
const toReview = computed(() => result.value?.review.filter(item => item.reason !== 'failed').length ?? 0)
</script>

<template>
  <div class="grid gap-3 p-(--liwan-card-pad-dense)" data-testid="finance-bank-auto-match">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <template v-if="result">
      <UAlert
        :color="result.applied ? 'success' : 'info'"
        variant="subtle"
        :title="t(result.applied ? 'financeBank.auto.applied' : 'financeBank.auto.found', { matched: result.matched.length, review: toReview }, result.matched.length)"
        data-testid="finance-bank-auto-result"
      >
        <template v-if="failed.length" #description>{{ t('financeBank.auto.failed', { count: failed.length }, failed.length) }}</template>
      </UAlert>
    </template>
    <div class="flex flex-wrap items-center gap-2">
      <UButton v-if="!result || result.applied" color="neutral" variant="outline" icon="i-lucide-wand-sparkles" :disabled="!hydrated" :loading="call.isPending.value" :label="t('financeBank.auto.check')" data-testid="finance-bank-auto-check" @click="run(false)" />
      <template v-else>
        <UButton color="primary" :disabled="!hydrated || !result.matched.length" :loading="call.isPending.value" :label="t('financeBank.auto.apply', { count: result.matched.length }, result.matched.length)" data-testid="finance-bank-auto-apply" @click="run(true)" />
        <UButton color="neutral" variant="outline" :disabled="call.isPending.value" :label="t('app.cancel')" @click="result = null" />
      </template>
    </div>
  </div>
</template>
