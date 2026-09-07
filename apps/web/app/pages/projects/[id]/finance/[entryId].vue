<script setup lang="ts">
import { toast } from 'vue-sonner'
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
    toast.success(t('projects.finance.deleted'))
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
      <div v-if="entry && canManage && projectId && entryId" class="flex flex-wrap gap-2">
        <NuxtLink :to="{ path: `/projects/${projectId}/finance/${entryId}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">
          <Button :disabled="!hydrated">{{ t('app.edit') }}</Button>
        </NuxtLink>
        <Button variant="outline" :disabled="!hydrated || deleting" @click="confirmDelete = !confirmDelete">{{ t('projects.finance.delete') }}</Button>
      </div>
    </SharedPageHeader>

    <template v-if="projectId === null || entryId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="(query.isLoading.value || access.isLoading.value) && !entry"
      :error="notFound ? null : query.error.value || access.error.value"
      @retry="() => { void query.refetch(); void access.refetch() }"
    >
      <p v-if="notFound && !query.isLoading.value" class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <template v-else-if="entry && currency">
        <div v-if="confirmDelete" data-testid="finance-delete-confirm" class="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
          <p>{{ entry.kind === 'budget' ? t('projects.finance.deleteBudgetConfirm') : t('projects.finance.deleteExpenseConfirm') }}</p>
          <p v-if="deleteError" class="mt-2 text-destructive">{{ deleteError }}</p>
          <div class="mt-3 flex gap-2">
            <Button variant="destructive" :disabled="!hydrated || deleting" @click="confirmRemoval">{{ t('projects.finance.delete') }}</Button>
            <Button variant="outline" :disabled="deleting" @click="confirmDelete = false">{{ t('app.cancel') }}</Button>
          </div>
        </div>
        <Card class="nasq-panel">
          <CardContent class="space-y-3 pt-6 text-sm">
            <p><span class="text-muted-foreground">{{ t('projects.finance.fields.kind') }}: </span>{{ t(`projects.finance.kind.${entry.kind}`) }}</p>
            <p><span class="text-muted-foreground">{{ t('projects.finance.fields.amount') }}: </span><span dir="ltr" class="tabular-nums">{{ formatMoney(entry.amount, currency) }}</span></p>
            <p v-if="entry.kind === 'expense'"><span class="text-muted-foreground">{{ t('projects.finance.fields.expense_date') }}: </span>{{ entry.expense_date ? formatCalendarDate(entry.expense_date, locale) : '—' }}</p>
            <p><span class="text-muted-foreground">{{ t('projects.finance.fields.reference') }}: </span>{{ entry.reference || '—' }}</p>
            <p class="whitespace-pre-wrap"><span class="text-muted-foreground">{{ t('projects.finance.fields.notes') }}: </span>{{ entry.notes || '—' }}</p>
            <p v-if="entry.kind === 'expense'">
              <span class="text-muted-foreground">{{ t('projects.finance.fields.budget_entry_id') }}: </span>
              <NuxtLink v-if="entry.budget_entry_id" :to="{ path: `/projects/${projectId}/finance/${entry.budget_entry_id}`, query: returnToQuery(route.fullPath) }" class="underline underline-offset-4">
                {{ t('projects.finance.linkedBudget', { id: entry.budget_entry_id }) }}
              </NuxtLink>
              <span v-else>{{ t('projects.finance.budgetNone') }}</span>
            </p>
          </CardContent>
        </Card>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <KeepAlive v-else>
    <NuxtPage :page-key="editPageKey" />
  </KeepAlive>
</template>
