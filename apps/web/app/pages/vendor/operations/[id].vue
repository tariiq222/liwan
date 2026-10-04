<script setup lang="ts">
import type { Operation as LegacyOperation, OperationFeed } from '@nasq/commercial-contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
type Operation = LegacyOperation | OperationFeed

const { t } = useI18n()
const route = useRoute()
const { request } = useVendorApi()
const id = computed(() => String(route.params.id))
const source = computed(() => route.query.source === undefined ? 'legacy' : String(route.query.source))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/vendor/operations', ['/vendor/operations']))
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
    await navigateTo({ path: `/vendor/operations/${encodeURIComponent(next.id)}`, query: { returnTo: backTo.value } })
  } catch (cause) {
    actionError.value = cause
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.operations.details')" :description="data?.id" :back-to="backTo">
      <template #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="pending" @click="manualRefresh">{{ t('vendor.common.refresh') }}</UButton>
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !data" @retry="refresh">
      <div v-if="data" class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <dl class="grid gap-4 sm:grid-cols-2">
            <div><dt class="text-sm text-muted">{{ t('vendor.operations.type') }}</dt><dd class="mt-1">{{ t(`vendor.operations.types.${data.type}`, data.type) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.common.status') }}</dt><dd class="mt-1"><UBadge color="neutral" variant="subtle">{{ t(`vendor.status.${data.status}`) }}</UBadge></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.operations.stage') }}</dt><dd class="mt-1">{{ t(`vendor.operations.stages.${data.stage}`, data.stage) }}</dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.operations.target') }}</dt><dd class="mt-1"><NuxtLink :to="`/vendor/tenants/${data.tenant_id}`" class="text-primary underline"><bdi>{{ data.tenant_id }}</bdi></NuxtLink></dd></div>
            <div><dt class="text-sm text-muted">{{ t('vendor.operations.requestId') }}</dt><dd class="mt-1 break-all font-mono text-xs">{{ data.request_id }}</dd></div>
          </dl>
          <p class="mt-4 text-sm">{{ isShared ? t(`vendor.operations.reasons.${data.reason}`) : data.reason }}</p>
          <UAlert v-if="isShared" class="mt-4" color="info" variant="subtle" :title="t('vendor.operations.sharedExecution')" :description="t('vendor.operations.sharedExecutionHint')" />
          <UAlert v-if="needsAttention" class="mt-4" color="warning" variant="subtle" :title="t(deploymentIncomplete ? 'vendor.operations.deploymentIncomplete' : 'vendor.operations.needsAttention')" :description="t('vendor.operations.reconcileHint')" />
          <UAlert v-else-if="backupUnverified" class="mt-4" color="warning" variant="subtle" :title="t('vendor.operations.backupUnverified')" :description="t('vendor.operations.backupUnverifiedHint')" />
          <div v-if="can('vendor.operations.run') && canRetry" class="mt-5 border-t border-default pt-4">
            <h2 class="font-medium">{{ t('vendor.operations.retryTitle') }}</h2>
            <p class="my-2 text-sm text-muted">{{ t('vendor.operations.retryHint') }}</p>
            <UAlert v-if="actionError" color="error" variant="subtle" :title="t('vendor.errors.action')" />
            <form class="grid gap-3" @submit.prevent="retry">
              <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="reason" required maxlength="1000" class="w-full" /></UFormField>
              <div><UButton type="submit" color="neutral" variant="outline" :loading="busy" :disabled="busy || !reason.trim()">{{ t('vendor.operations.retry') }}</UButton></div>
            </form>
          </div>
        </UCard>

        <UCard>
          <template #header><h2 class="font-medium">{{ t('vendor.operations.events') }}</h2></template>
          <ol v-if="data.events?.length" class="grid gap-3">
            <li v-for="(event, index) in data.events" :key="`${event.at}:${index}`" class="border-s-2 border-default ps-3">
              <p class="font-medium">{{ t(`vendor.operations.stages.${event.stage}`, event.stage) }} · {{ t(`vendor.status.${event.status}`) }}</p>
              <time class="text-xs text-muted" :datetime="event.at">{{ new Date(event.at).toLocaleString() }}</time>
            </li>
          </ol>
          <p v-else class="text-sm text-muted">{{ t('vendor.operations.noEvents') }}</p>
          <p v-if="isActive && !pollingPaused" class="mt-4 text-xs text-muted" role="status">{{ t('vendor.operations.autoRefreshHint') }}</p>
          <p v-if="pollingPaused" class="mt-4 text-xs text-muted" role="status">{{ t('vendor.operations.pollingPaused') }}</p>
        </UCard>

        <UCard v-if="data.result" class="lg:col-span-2">
          <details>
            <summary class="cursor-pointer font-medium">{{ t('vendor.operations.result') }}</summary>
            <pre class="mt-3 max-h-96 overflow-auto rounded-md bg-elevated p-3 text-xs">{{ JSON.stringify(data.result, null, 2) }}</pre>
          </details>
        </UCard>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
