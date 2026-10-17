<script setup lang="ts">
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'
import { operationStatusBadge } from '@/utils/vendorBadges'
import type { Operation as LegacyOperation, OperationFeed } from '@webvue/commercial-contracts'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { operationTargetTo } from '@/utils/vendorOperations'
definePageMeta({ capability: 'vendor.read' })
type Operation = LegacyOperation | OperationFeed

const { t } = useI18n()
const route = useRoute()
const { request } = useVendorApi()
const id = computed(() => String(route.params.id))
const source = computed(() => route.query.source === undefined ? 'legacy' : String(route.query.source))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/operations', ['/operations', '/overview']))
const { data, error, pending, refresh } = await useAsyncData(
  () => `vendor:operation:${source.value}:${id.value}`,
  () => request<Operation>(`operations/${encodeURIComponent(id.value)}`, { query: { source: source.value } }),
)
const { can } = useVendorContext()
const busy = ref(false)
const reason = ref('')
const actionError = ref<unknown>(null)
const pollCount = ref(0)
let pollTimer: ReturnType<typeof setTimeout> | undefined

const isActive = computed(() => data.value?.status === 'queued' || data.value?.status === 'running')
const isShared = computed(() => source.value === 'shared' || (data.value && 'source' in data.value && data.value.source === 'shared'))
const canRetry = computed(() => !isShared.value && data.value?.status === 'failed' && ['tenant.inspect', 'health'].includes(data.value.type))
const needsAttention = computed(() => data.value?.status === 'needs_intervention' || data.value?.stage === 'deployment_incomplete')
const deploymentIncomplete = computed(() => data.value?.stage === 'deployment_incomplete' || data.value?.result?.deployment_ready === false)
const targetTo = computed(() => data.value ? operationTargetTo(data.value) : null)
const updatedAt = computed(() => (data.value && 'last_event_at' in data.value && data.value.last_event_at) || data.value?.updated_at || null)
const backupUnverified = computed(() => data.value?.type === 'backup' && data.value?.result?.consistency === 'UNVERIFIED')

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
}

const pollingPaused = computed(() => isActive.value && pollCount.value >= 24)

function schedulePoll() {
  stopPolling()
  if (!import.meta.client || !isActive.value || pollCount.value >= 24) return
  pollTimer = setTimeout(async () => {
    pollTimer = undefined
    pollCount.value++
    await refresh()
    schedulePoll()
  }, 5000)
}

async function manualRefresh() {
  pollCount.value = 0
  await refresh()
  schedulePoll()
}

watch(isActive, schedulePoll)
onMounted(schedulePoll)
onBeforeUnmount(stopPolling)

async function retry() {
  if (!data.value || !canRetry.value || !can('vendor.operations.run') || busy.value || !reason.value.trim()) return
  busy.value = true
  actionError.value = null
  try {
    const next = await request<{ id: string }>(`operations/${encodeURIComponent(data.value.id)}/retry`, {
      method: 'POST',
      body: { request_id: crypto.randomUUID(), reason: reason.value },
    })
    reason.value = ''
    await navigateTo({ path: `/operations/${encodeURIComponent(next.id)}`, query: { returnTo: backTo.value } })
  } catch (cause) {
    actionError.value = cause
  } finally {
    busy.value = false
  }
}
</script>

<template>

    <SharedRecordPage :title="data ? t(`vendor.operations.types.${data.type}`, data.type) : t('vendor.operations.details')" :description="data ? (isShared ? t(`vendor.operations.reasons.${data.reason}`) : data.reason) : undefined" :back-to="backTo" :loading="pending" :error="error" @retry="refresh">
      <template #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="pending" @click="manualRefresh">{{ t('vendor.common.refresh') }}</UButton>
      </template>

      <template v-if="data" #summary>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="operation-summary">
          <SharedStatusBadge :tone="operationStatusBadge(data.status).tone" :label="t(operationStatusBadge(data.status).labelKey)" />
          <span class="text-sm text-muted">{{ t('vendor.operations.stage') }}: {{ t(`vendor.operations.stages.${data.stage}`, data.stage) }}</span>
        </div>
      </template>

      <div v-if="data" class="space-y-6">
        <div v-if="isShared || needsAttention || backupUnverified" class="space-y-3">
          <UAlert v-if="isShared" color="info" variant="subtle" :title="t('vendor.operations.sharedExecution')" :description="t('vendor.operations.sharedExecutionHint')" />
          <UAlert v-if="needsAttention" color="warning" variant="subtle" :title="t(deploymentIncomplete ? 'vendor.operations.deploymentIncomplete' : 'vendor.operations.needsAttention')" :description="t('vendor.operations.reconcileHint')" />
          <UAlert v-else-if="backupUnverified" color="warning" variant="subtle" :title="t('vendor.operations.backupUnverified')" :description="t('vendor.operations.backupUnverifiedHint')" />
        </div>

        <SharedRecordSection v-if="can('vendor.operations.run') && canRetry" :title="t('vendor.operations.retryTitle')" :description="t('vendor.operations.retryHint')" variant="panel">
          <UAlert v-if="actionError" class="mb-3" color="error" variant="subtle" :title="t('vendor.errors.action')" />
          <form class="grid gap-3" @submit.prevent="retry">
            <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="reason" required maxlength="1000" class="w-full" /></UFormField>
            <div><UButton type="submit" color="neutral" variant="outline" :loading="busy" :disabled="busy || !reason.trim()">{{ t('vendor.operations.retry') }}</UButton></div>
          </form>
        </SharedRecordSection>

        <SharedRecordSection :title="t('vendor.operations.events')">
          <ol v-if="data.events?.length" class="grid gap-3" data-testid="operation-events">
            <li v-for="(event, index) in data.events" :key="`${event.at}:${index}`" class="border-s-2 border-default ps-3">
              <p class="flex flex-wrap items-center gap-2 font-medium">{{ t(`vendor.operations.stages.${event.stage}`, event.stage) }} <SharedStatusBadge :tone="operationStatusBadge(event.status).tone" :label="operationStatusBadge(event.status).labelKey ? t(operationStatusBadge(event.status).labelKey) : event.status" /></p>
              <time class="text-xs text-muted" :datetime="event.at">{{ formatWebVueDateTime(event.at) }}</time>
            </li>
          </ol>
          <p v-else class="text-sm text-muted">{{ t('vendor.operations.noEvents') }}</p>
          <p v-if="isActive && !pollingPaused" class="mt-4 text-xs text-muted" role="status">{{ t('vendor.operations.autoRefreshHint') }}</p>
          <p v-if="pollingPaused" class="mt-4 text-xs text-muted" role="status">{{ t('vendor.operations.pollingPaused') }}</p>
        </SharedRecordSection>

        <details data-testid="operation-technical">
          <summary class="cursor-pointer font-medium">{{ t('vendor.operations.result') }}</summary>
          <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
            <dt class="text-muted">{{ t('vendor.operations.operationId') }}</dt><dd><bdi dir="ltr" class="break-all">{{ data.id }}</bdi></dd>
            <dt class="text-muted">{{ t('vendor.operations.requestId') }}</dt><dd><bdi dir="ltr" class="break-all">{{ data.request_id }}</bdi></dd>
            <dt class="text-muted">{{ t('vendor.operations.workspaceId') }}</dt><dd><bdi dir="ltr" class="break-all">{{ data.tenant_id }}</bdi></dd>
            <template v-if="data.customer_id"><dt class="text-muted">{{ t('vendor.operations.customerId') }}</dt><dd><bdi dir="ltr" class="break-all">{{ data.customer_id }}</bdi></dd></template>
          </dl>
          <pre v-if="data.result" class="mt-3 max-h-96 overflow-auto rounded-md bg-elevated p-3 text-xs" dir="ltr">{{ JSON.stringify(data.result, null, 2) }}</pre>
        </details>
      </div>

  <template #aside><SharedPropertiesPanel v-if="data">
            <SharedPropertyRow :label="t('vendor.operations.target')"><NuxtLink v-if="targetTo" :to="targetTo" class="text-primary underline" data-testid="operation-target"><bdi>{{ data.tenant_name ?? data.tenant_id }}</bdi></NuxtLink></SharedPropertyRow>
            <SharedPropertyRow :label="t('vendor.operations.created')" :value="formatWebVueDateTime(data.created_at)" />
            <SharedPropertyRow v-if="updatedAt" :label="t('vendor.operations.updated')" :value="formatWebVueDateTime(updatedAt)" />
          </SharedPropertiesPanel></template>
</SharedRecordPage>
</template>
