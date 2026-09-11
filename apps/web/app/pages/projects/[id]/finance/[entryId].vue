<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useDeleteFinanceEntry, useProjectFinanceEntry, useProjectFinanceList } from '@/composables/useProjectFinance'
import {
  FINANCE_RETURN_PREFIXES,
  financeWriteAllowed,
  formatMoney,
  isReferencedBudgetConflict,
  parsePositiveId,
} from '@/utils/projectFinance'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const projectId = computed(() => parsePositiveId(route.params.id))
const entryId = computed(() => parsePositiveId(route.params.entryId))
const isDetailRoute = computed(() => {
  const project = projectId.value
  const entry = entryId.value
  if (project == null || entry == null) return !normalizedPath.value.endsWith('/edit')
  return normalizedPath.value === `/projects/${project}/finance/${entry}`
})
const access = useProjectFinanceList(computed(() => isDetailRoute.value ? projectId.value : null), { limit: 1, offset: 0 })
const query = useProjectFinanceEntry(
  computed(() => isDetailRoute.value ? projectId.value : null),
  computed(() => isDetailRoute.value ? entryId.value : null),
)
const canManage = computed(() => financeWriteAllowed(access.data.value, access.error.value))
const currency = computed(() => access.data.value?.summary.currency)
const entry = computed(() => {
  const record = query.data.value
  if (!record || projectId.value == null || record.project_id !== projectId.value) return null
  return record
})
const mismatched = computed(() => !!query.data.value && projectId.value != null && query.data.value.project_id !== projectId.value)
const notFound = computed(() =>
  projectId.value === null
  || entryId.value === null
  || mismatched.value
  || (query.error.value instanceof ApiError && [403, 404].includes(query.error.value.status))
  || (access.error.value instanceof ApiError && [403, 404].includes(access.error.value.status)),
)
const listFallback = computed(() => projectId.value ? `/projects/${projectId.value}/finance` : '/projects')
const returnTo = computed(() => safeReturnTo(route.query.returnTo, listFallback.value, FINANCE_RETURN_PREFIXES))
const confirmDelete = ref(false)
const deleteError = ref<string | null>(null)
const { mutateAsync: remove, isPending: deleting } = useDeleteFinanceEntry()

function editPageKey(target: { params: Record<string, string | string[]> }) {
  const project = Array.isArray(target.params.id) ? target.params.id[0] : target.params.id
  const entry = Array.isArray(target.params.entryId) ? target.params.entryId[0] : target.params.entryId
  return `finance-edit-${project}-${entry}`
}

async function confirmRemoval() {
  if (!hydrated.value || !canManage.value || !entry.value || deleting.value) return
  deleteError.value = null
  try {
    await remove({ projectId: entry.value.project_id, entryId: entry.value.id, expected_updated_at: entry.value.updated_at })
    toast.add({ title: t('projects.finance.deleted'), color: 'success', icon: 'i-lucide-circle-check' })
    confirmDelete.value = false
    void router.push(returnTo.value)
  }
  catch (error) {
    deleteError.value = isReferencedBudgetConflict(error)
      ? t('projects.finance.errors.referencedBudget')
      : error instanceof ApiError ? error.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedPageContainer v-if="isDetailRoute" width="detail" data-testid="finance-entry-detail">
    <SharedPageHeader :title="entry?.title || t('projects.finance.detailTitle')" :back-to="returnTo" :back-label="t('projects.finance.backToLedger')">
      <template #actions>
        <div v-if="entry && canManage && projectId && entryId" class="flex flex-wrap gap-2">
        <UButton :disabled="!hydrated" :to="{ path: `/projects/${projectId}/finance/${entryId}/edit`, query: returnToQuery(route.fullPath) }">{{ t('app.edit') }}</UButton>
        <UButton color="error" variant="outline" :disabled="!hydrated || deleting" @click="confirmDelete = !confirmDelete">{{ t('projects.finance.delete') }}</UButton>
        </div>
      </template>
    </SharedPageHeader>

    <template v-if="projectId === null || entryId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="(query.isLoading.value || access.isLoading.value) && !entry"
      :error="notFound ? null : query.error.value || access.error.value"
      @retry="() => { void query.refetch(); void access.refetch() }"
    >
      <p v-if="notFound && !query.isLoading.value" class="text-muted">{{ t('projects.notFound') }}</p>
      <template v-else-if="entry && currency">
        <UAlert v-if="confirmDelete" data-testid="finance-delete-confirm" color="error" variant="soft" :title="entry.kind === 'budget' ? t('projects.finance.deleteBudgetConfirm') : t('projects.finance.deleteExpenseConfirm')" :description="deleteError ?? undefined">
          <template #actions>
            <UButton color="error" :disabled="!hydrated || deleting" @click="confirmRemoval">{{ t('projects.finance.delete') }}</UButton>
            <UButton color="neutral" variant="outline" :disabled="deleting" @click="confirmDelete = false">{{ t('app.cancel') }}</UButton>
          </template>
        </UAlert>
        <section class="rounded-xl border border-default bg-default overflow-hidden" aria-labelledby="finance-entry-summary-title">
          <div class="border-b border-default px-5 py-4">
            <h2 id="finance-entry-summary-title" class="text-lg font-semibold text-highlighted">{{ t('projects.finance.detailTitle') }}</h2>
          </div>
          <div class="p-5 space-y-5">
            <div>
            <p class="text-sm text-muted">{{ t('projects.finance.fields.amount') }}</p>
            <p dir="ltr" class="mt-1 text-2xl font-semibold tabular-nums">{{ formatMoney(entry.amount, currency) }}</p>
            </div>
            <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div><dt class="text-muted">{{ t('projects.finance.fields.kind') }}</dt><dd class="mt-1 font-medium">{{ t(`projects.finance.kind.${entry.kind}`) }}</dd></div>
            <div v-if="entry.kind === 'expense'"><dt class="text-muted">{{ t('projects.finance.fields.expense_date') }}</dt><dd class="mt-1">{{ entry.expense_date ? formatCalendarDate(entry.expense_date, locale) : '—' }}</dd></div>
            <div><dt class="text-muted">{{ t('projects.finance.fields.reference') }}</dt><dd class="mt-1">{{ entry.reference || '—' }}</dd></div>
            <div v-if="entry.kind === 'expense'"><dt class="text-muted">{{ t('projects.finance.fields.budget_entry_id') }}</dt><dd class="mt-1"><NuxtLink v-if="entry.budget_entry_id" :to="{ path: `/projects/${projectId}/finance/${entry.budget_entry_id}`, query: returnToQuery(route.fullPath) }" class="underline underline-offset-4">{{ t('projects.finance.linkedBudget', { id: entry.budget_entry_id }) }}</NuxtLink><span v-else>{{ t('projects.finance.budgetNone') }}</span></dd></div>
            <div class="sm:col-span-2"><dt class="text-muted">{{ t('projects.finance.fields.notes') }}</dt><dd class="mt-1 whitespace-pre-wrap">{{ entry.notes || '—' }}</dd></div>
            </dl>
          </div>
        </section>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <KeepAlive v-else>
    <NuxtPage :page-key="editPageKey" />
  </KeepAlive>
</template>
