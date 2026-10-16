<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { useDeleteFinanceEntry, useProjectFinanceEntry, useProjectFinanceList } from '@/composables/useProjectFinance'
import {
  financeWriteAllowed,
  formatMoney,
  isReferencedBudgetConflict,
} from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'

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
const sourcePaths = useProjectRecordListPaths(projectId, () => [projectId.value ? `/projects/${projectId.value}/finance` : '/projects'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const editTo = computed(() => recordChildTo(`/projects/${projectId.value}/finance/${entryId.value}/edit`, route.query, sourcePaths.value, route.hash))
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
    void router.push(backTo.value)
  }
  catch (error) {
    deleteError.value = isReferencedBudgetConflict(error)
      ? t('projects.finance.errors.referencedBudget')
      : error instanceof ApiError ? error.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedRecordPage :keep-content="!!entry"
    v-if="isDetailRoute"
    data-testid="finance-entry-detail"
    :title="entry?.title || t('projects.finance.detailTitle')"
    :back-to="backTo"
    :back-label="t('projects.finance.backToLedger')"
    :loading="(query.isLoading.value || access.isLoading.value) && !entry"
    :error="notFound || projectId === null || entryId === null ? null : query.error.value || access.error.value"
    @retry="() => { void query.refetch(); void access.refetch() }"
  >
    <template v-if="entry && canManage && projectId && entryId" #actions>
      <UButton icon="i-lucide-pencil" :disabled="!hydrated" :to="editTo">{{ t('app.edit') }}</UButton>
      <UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated || deleting" @click="confirmDelete = !confirmDelete">{{ t('projects.finance.delete') }}</UButton>
    </template>
    <p v-if="projectId === null || entryId === null" class="text-muted">{{ t('projects.invalidId') }}</p>
    <p v-else-if="notFound" class="text-muted">{{ t('projects.notFound') }}</p>
    <template v-else-if="entry && currency">
      <SharedInlineConfirm
        v-if="confirmDelete"
        data-testid="finance-delete-confirm"
        :title="entry.kind === 'budget' ? t('projects.finance.deleteBudgetConfirm') : t('projects.finance.deleteExpenseConfirm')"
        :confirm-label="t('projects.finance.delete')"
        :pending="deleting"
        :disabled="!canManage"
        @cancel="confirmDelete = false"
        @confirm="confirmRemoval"
      >
        <p v-if="deleteError" class="text-error">{{ deleteError }}</p>
      </SharedInlineConfirm>
      <SharedRecordSection panel id="finance-entry-amount" :title="t('projects.finance.fields.amount')">
        <p dir="ltr" class="text-2xl font-semibold tabular-nums">{{ formatMoney(entry.amount, currency) }}</p>
        <p v-if="entry.notes" class="mt-2 whitespace-pre-wrap text-sm">{{ entry.notes }}</p>
      </SharedRecordSection>
    </template>
    <template v-if="entry && currency" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('projects.finance.fields.kind')" :value="t(`projects.finance.kind.${entry.kind}`)" />
        <SharedPropertyRow v-if="entry.kind === 'expense'" :label="t('projects.finance.fields.expense_date')" :value="entry.expense_date ? formatCalendarDate(entry.expense_date, locale) : null" />
        <SharedPropertyRow :label="t('projects.finance.fields.reference')" :value="entry.reference" />
        <SharedPropertyRow v-if="entry.kind === 'expense'" :label="t('projects.finance.fields.budget_entry_id')">
          <NuxtLink v-if="entry.budget_entry_id" :to="`/projects/${projectId}/finance/${entry.budget_entry_id}`" class="underline underline-offset-4">{{ t('projects.finance.linkedBudget', { id: entry.budget_entry_id }) }}</NuxtLink>
          <span v-else>{{ t('projects.finance.budgetNone') }}</span>
        </SharedPropertyRow>
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <KeepAlive v-else>
    <NuxtPage :page-key="editPageKey" />
  </KeepAlive>
</template>
