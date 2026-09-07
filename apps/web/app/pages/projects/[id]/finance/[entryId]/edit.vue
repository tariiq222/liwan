<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceEntry, useProjectFinanceList } from '@/composables/useProjectFinance'
import FinanceEntryForm from '@/components/project/finance/FinanceEntryForm.vue'
import {
  FINANCE_RETURN_PREFIXES,
  financeWriteAllowed,
  parsePositiveId,
  shouldKeepFinanceFormMounted,
} from '@/utils/projectFinance'
import { safeReturnTo } from '@/utils/safeReturnTo'

defineOptions({ name: 'ProjectFinanceEntryEdit' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => parsePositiveId(route.params.id))
const entryId = computed(() => parsePositiveId(route.params.entryId))
const access = useProjectFinanceList(projectId, { limit: 1, offset: 0 })
const query = useProjectFinanceEntry(projectId, entryId)
const currency = computed(() => access.data.value?.summary.currency)
const entry = computed(() => {
  const record = query.data.value
  if (!record || projectId.value == null || record.project_id !== projectId.value) return null
  return record
})
const mismatched = computed(() => !!query.data.value && projectId.value != null && query.data.value.project_id !== projectId.value)
const writeAllowed = computed(() => financeWriteAllowed(access.data.value, access.error.value))
const hadWriteAccess = ref(false)
watch(writeAllowed, (allowed) => { if (allowed) hadWriteAccess.value = true }, { immediate: true })
const keepForm = computed(() =>
  shouldKeepFinanceFormMounted({ hasCachedEntry: !!entry.value, hasCachedAccess: !!access.data.value })
  && !!entry.value
  && !!currency.value
  && !!projectId.value
  && (writeAllowed.value || hadWriteAccess.value),
)
const notFound = computed(() =>
  projectId.value === null
  || entryId.value === null
  || mismatched.value
  || (!keepForm.value && query.error.value instanceof ApiError && [403, 404].includes(query.error.value.status))
  || (!keepForm.value && access.error.value instanceof ApiError && [403, 404].includes(access.error.value.status)),
)
const initialLoading = computed(() =>
  !keepForm.value
  && ((query.isLoading.value && !entry.value) || (access.isLoading.value && !access.data.value)),
)
const pageError = computed(() => keepForm.value ? null : (notFound.value ? null : query.error.value || access.error.value))
const refreshError = computed(() => keepForm.value ? query.error.value || access.error.value : null)
const detailFallback = computed(() => {
  if (projectId.value && entryId.value) return `/projects/${projectId.value}/finance/${entryId.value}`
  if (projectId.value) return `/projects/${projectId.value}/finance`
  return '/projects'
})
const returnTo = computed(() => safeReturnTo(route.query.returnTo, detailFallback.value, FINANCE_RETURN_PREFIXES))

function saved() {
  toast.success(t('projects.finance.saved'))
  void router.push(returnTo.value)
}

function retry() {
  void query.refetch()
  void access.refetch()
}
</script>

<template>
  <section class="nasq-page-stack mx-auto w-full max-w-4xl">
    <SharedPageHeader :title="t('projects.finance.editTitle')" :back-to="returnTo" :back-label="t('projects.finance.backToLedger')" />
    <template v-if="projectId === null || entryId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else>
      <SharedPageState
        v-if="!keepForm"
        :loading="initialLoading"
        :error="pageError"
        :empty="!initialLoading && !pageError && notFound"
        :empty-text="t('projects.notFound')"
        @retry="retry"
      />
      <template v-else>
        <div v-if="refreshError" role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>{{ t('projects.finance.refreshError') }}</p>
          <Button variant="outline" class="mt-3" type="button" @click="retry">{{ t('app.retry') }}</Button>
        </div>
        <Card class="nasq-form">
          <CardContent class="pt-6">
            <FinanceEntryForm
              :project-id="projectId"
              :currency="currency!"
              :entry="entry!"
              :write-allowed="writeAllowed"
              @saved="saved"
              @cancel="router.push(returnTo)"
            />
          </CardContent>
        </Card>
      </template>
    </template>
  </section>
</template>
