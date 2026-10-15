<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceEntry, useProjectFinanceList } from '@/composables/useProjectFinance'
import FinanceEntryForm from '@/components/pmo/projects/finance/FinanceEntryForm.vue'
import {
  financeWriteAllowed,
  shouldKeepFinanceFormMounted,
} from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'

defineOptions({ name: 'ProjectFinanceEntryEdit' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
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
const backTo = computed(() => recordParentTo(projectId.value && entryId.value ? `/projects/${projectId.value}/finance/${entryId.value}` : projectId.value ? `/projects/${projectId.value}/finance` : '/projects', route.query, [projectId.value ? `/projects/${projectId.value}/finance` : '/projects'], route.hash))

function saved() {
  toast.add({ title: t('projects.finance.saved'), color: 'success', icon: 'i-lucide-circle-check' })
  void router.push(backTo.value)
}

function retry() {
  void query.refetch()
  void access.refetch()
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.finance.editTitle')" :back-to="backTo" :back-label="t('projects.finance.backToLedger')" />
    <template v-if="projectId === null || entryId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else>
      <SharedPageState
        v-if="!keepForm"
        :loading="initialLoading"
        :error="pageError"
        :empty="!initialLoading && !pageError && (notFound || (!!access.data.value && !writeAllowed))"
        :empty-text="notFound ? t('projects.notFound') : t('projects.forbidden')"
        @retry="retry"
      />
      <template v-else>
        <UAlert v-if="refreshError" color="error" variant="soft" :title="t('projects.finance.refreshError')">
          <template #actions>
            <UButton color="neutral" variant="outline" type="button" @click="retry">{{ t('app.retry') }}</UButton>
          </template>
        </UAlert>
        <SharedFormSection panel>
            <FinanceEntryForm
              :project-id="projectId"
              :currency="currency!"
              :entry="entry!"
              :write-allowed="writeAllowed"
              @saved="saved"
              @cancel="router.push(backTo)"
            />
          </SharedFormSection>
      </template>
    </template>
  </SharedPageContainer>
</template>
