<script setup lang="ts">
import type { FinanceZakatBase } from '@liwan/contracts'
import { useReviewZakat } from '@/composables/finance/useFinanceZakat'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'

// The accountant's review of the Zakat computation as it stands. The status is the server's: management information until
// someone reviews it, reviewed while the books and adjustments are unchanged, stale once either changes. Reviewing states the
// reviewer's credential (LiwanOS does not verify it), is permanent, and only whoever holds the review capability can do it.
// Nothing is filed from here whatever the status.
const props = defineProps<{ report: FinanceZakatBase }>()
const { t, d } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canReview = computed(() => can('finance.zakat.review'))
const review = useReviewZakat()
const opening = ref(false)
const draft = reactive({ credential: '', note: '' })
const error = ref('')
const TONES = { management_information: 'warning', reviewed: 'success', review_stale: 'warning' } as const

async function submit() {
  if (!hydrated.value || review.isPending.value || draft.credential.trim() === '') return
  error.value = ''
  try {
    await review.mutateAsync({ date_to: props.report.date_to, credential: draft.credential.trim(), ...(draft.note.trim() ? { note: draft.note.trim() } : {}) })
    opening.value = false
    Object.assign(draft, { credential: '', note: '' })
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <section class="grid gap-3 border-t border-default p-(--liwan-card-pad-dense)" data-testid="finance-zakat-review">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="font-semibold text-highlighted">{{ t('financeReports.zakat.reviewTitle') }}</h3>
      <SharedStatusBadge size="sm" :tone="TONES[report.status]" :label="t(`financeReports.zakat.status.${report.status}`)" data-testid="finance-zakat-status" />
    </div>
    <p class="text-sm text-muted">{{ t('financeReports.zakat.notFiled') }}</p>
    <p v-if="report.review" class="text-sm" data-testid="finance-zakat-last-review">
      {{ t('financeReports.zakat.reviewedBy', { name: report.review.reviewer.name, credential: report.review.credential, date: d(new Date(report.review.reviewed_at), { dateStyle: 'medium' }) }) }}
      <span v-if="report.review.note" class="block text-muted">{{ report.review.note }}</span>
    </p>
    <UAlert v-if="report.status === 'review_stale'" role="alert" color="warning" variant="subtle" :title="t('financeReports.zakat.staleTitle')" :description="t('financeReports.zakat.staleHint')" />
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <template v-if="canReview">
      <UButton v-if="!opening" color="neutral" variant="outline" icon="i-lucide-badge-check" class="w-fit" :disabled="!hydrated" :label="t('financeReports.zakat.review')" data-testid="finance-zakat-review-open" @click="opening = true" />
      <UForm v-else novalidate :state="draft" class="liwan-form rounded-card border border-default p-(--liwan-card-pad-dense)" method="post" data-testid="finance-zakat-review-form" @submit="submit">
        <p class="text-sm text-muted">{{ t('financeReports.zakat.reviewHint') }}</p>
        <UFormField :label="t('financeReports.zakat.credential')" name="finance-zakat-credential" required :help="t('financeReports.zakat.credentialHelp')">
          <UInput id="finance-zakat-credential" v-model="draft.credential" class="w-full" maxlength="255" :disabled="!hydrated || review.isPending.value" />
        </UFormField>
        <UFormField :label="t('financeReports.zakat.note')" name="finance-zakat-review-note"><UInput id="finance-zakat-review-note" v-model="draft.note" class="w-full" maxlength="255" :disabled="!hydrated || review.isPending.value" /></UFormField>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="review.isPending.value" :label="t('app.cancel')" @click="opening = false" />
          <UButton type="submit" color="primary" :disabled="!hydrated || draft.credential.trim() === ''" :loading="review.isPending.value" :label="t('financeReports.zakat.confirmReview')" data-testid="finance-zakat-review-submit" />
        </div>
      </UForm>
    </template>
  </section>
</template>
