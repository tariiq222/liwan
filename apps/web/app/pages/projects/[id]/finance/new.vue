<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import FinanceEntryForm from '@/components/pmo/projects/finance/FinanceEntryForm.vue'
import {
  financeWriteAllowed,
  isExternalActual,
  parseFinanceKind,
  shouldKeepFinanceFormMounted,
} from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'

defineOptions({ name: 'ProjectFinanceEntryNew' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const projectId = computed(() => parsePositiveId(route.params.id))
const access = useProjectFinanceList(projectId, { limit: 1, offset: 0 })
const currency = computed(() => access.data.value?.summary.currency)
const writeAllowed = computed(() => financeWriteAllowed(access.data.value, access.error.value))
const hadWriteAccess = ref(false)
watch(writeAllowed, (allowed) => { if (allowed) hadWriteAccess.value = true }, { immediate: true })
const keepForm = computed(() =>
  shouldKeepFinanceFormMounted({ hasCachedEntry: false, hasCachedAccess: !!access.data.value })
  && !!currency.value
  && !!projectId.value
  && (writeAllowed.value || hadWriteAccess.value),
)
const notFound = computed(() =>
  projectId.value === null
  || (!keepForm.value && access.error.value instanceof ApiError && [403, 404].includes(access.error.value.status)),
)
const initialLoading = computed(() => !keepForm.value && access.isLoading.value && !access.data.value)
const pageError = computed(() => keepForm.value ? null : (notFound.value ? null : access.error.value))
const refreshError = computed(() => keepForm.value ? access.error.value : null)
const sourcePaths = useProjectRecordListPaths(projectId, () => [projectId.value ? `/projects/${projectId.value}/finance` : '/projects'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const externalActual = computed(() => access.data.value ? isExternalActual(access.data.value.summary) : false)
const defaultKind = computed(() => {
  const kind = parseFinanceKind(route.query.kind)
  return kind === 'all' || externalActual.value ? 'budget' : kind
})

function saved(entry: { id: number }) {
  toast.add({ title: t('projects.finance.created'), color: 'success', icon: 'i-lucide-circle-check' })
  void router.replace({ path: `/projects/${projectId.value}/finance/${entry.id}`, query: { returnTo: router.resolve(backTo.value).fullPath } })
}
</script>

<template>
  <SharedCreatePanel :title="t('projects.finance.createTitle')" :back-to="backTo">
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else>
      <SharedPageState
        v-if="!keepForm"
        :loading="initialLoading"
        :error="pageError"
        :empty="!initialLoading && !pageError && (notFound || (access.data.value && !writeAllowed))"
        :empty-text="notFound ? t('projects.notFound') : t('projects.forbidden')"
        @retry="access.refetch"
      />
      <template v-else>
        <UAlert v-if="refreshError" color="error" variant="soft" :title="t('projects.finance.refreshError')">
          <template #actions>
            <UButton color="neutral" variant="outline" type="button" @click="access.refetch()">{{ t('app.retry') }}</UButton>
          </template>
        </UAlert>
        <FinanceEntryForm
          :project-id="projectId"
          :currency="currency!"
          :default-kind="defaultKind"
          :external-actual="externalActual"
          :write-allowed="writeAllowed"
          @saved="saved"
          @cancel="router.push(backTo)"
        />
      </template>
    </template>
  </SharedCreatePanel>
</template>
