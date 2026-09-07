<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import FinanceEntryForm from '@/components/project/finance/FinanceEntryForm.vue'
import {
  FINANCE_RETURN_PREFIXES,
  financeWriteAllowed,
  parseFinanceKind,
  parsePositiveId,
  shouldKeepFinanceFormMounted,
} from '@/utils/projectFinance'
import { safeReturnTo } from '@/utils/safeReturnTo'

defineOptions({ name: 'ProjectFinanceEntryNew' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
const listFallback = computed(() => projectId.value ? `/projects/${projectId.value}/finance` : '/projects')
const returnTo = computed(() => safeReturnTo(route.query.returnTo, listFallback.value, FINANCE_RETURN_PREFIXES))
const defaultKind = computed(() => {
  const kind = parseFinanceKind(route.query.kind)
  return kind === 'all' ? 'budget' : kind
})

function saved() {
  toast.success(t('projects.finance.created'))
  void router.push(returnTo.value)
}
</script>

<template>
  <section class="nasq-page-stack mx-auto w-full max-w-4xl">
    <SharedPageHeader :title="t('projects.finance.createTitle')" :back-to="returnTo" :back-label="t('projects.finance.backToLedger')" />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
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
        <div v-if="refreshError" role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>{{ t('projects.finance.refreshError') }}</p>
          <Button variant="outline" class="mt-3" type="button" @click="access.refetch()">{{ t('app.retry') }}</Button>
        </div>
        <Card class="nasq-form">
          <CardContent class="pt-6">
            <FinanceEntryForm
              :project-id="projectId"
              :currency="currency!"
              :default-kind="defaultKind"
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
