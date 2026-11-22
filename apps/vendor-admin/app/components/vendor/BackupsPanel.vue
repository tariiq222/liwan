<script setup lang="ts">
import { formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { operationStatusBadge } from '@/utils/vendorBadges'
import { backupJobRequest, sharedBackupErrorKey, sharedJobLocation, startRefusalKey } from '@/utils/sharedBackups'
import { reasonValid } from '@/utils/team'
import { useSharedBackups } from '@/composables/useSharedBackups'
const props = defineProps<{ tenantId: string }>()
/** True while a typed reason has not been sent; the tab reports it so the page guards leaving. */
const dirtyModel = defineModel<boolean>('dirty', { default: false })
const { t } = useI18n()
const { request } = useVendorApi()
const { can } = useVendorContext()
const hydrated = useHydrated()
const { data, error, pending, refresh } = useSharedBackups(toRef(props, 'tenantId'))
const refusal = computed(() => (data.value ? startRefusalKey(data.value.start) : null))
const blockingJob = computed(() => (data.value && !data.value.start.allowed ? data.value.start.job_id : null))
const statusBadge = (state: string) => operationStatusBadge(state)

const startReason = ref('')
const confirmStart = ref(false)
const startBusy = ref(false)
const startError = ref<unknown>(null)
// One request id per backup the operator means to make: a retry after a lost answer sends the same id and gets the same job.
const startRequestId = ref<string | null>(null)
const canStart = computed(() => hydrated.value && can('vendor.operations.run') && !startBusy.value && reasonValid(startReason.value))
watch(() => startReason.value.trim(), () => { confirmStart.value = false })
watch(() => Boolean(startReason.value.trim()), value => { dirtyModel.value = value }, { immediate: true })
onBeforeUnmount(() => { dirtyModel.value = false })

async function startBackup() {
  if (!canStart.value) return
  startBusy.value = true
  startError.value = null
  startRequestId.value ??= crypto.randomUUID()
  try {
    const job = await request<{ id: string }>(`shared/tenants/${encodeURIComponent(props.tenantId)}/jobs`, { method: 'POST', body: backupJobRequest(startRequestId.value, startReason.value) })
    startReason.value = ''
    startRequestId.value = null
    await navigateTo({ path: `/operations/${encodeURIComponent(job.id)}`, query: { source: 'shared', returnTo: `/operations?tenant_id=${encodeURIComponent(props.tenantId)}` } })
  } catch (cause) { startError.value = cause }
  finally { startBusy.value = false; confirmStart.value = false }
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('vendor.backups.title')" :description="t('vendor.backups.hint')" data-testid="backups-panel">
    <SharedPageState :loading="pending && !data" :error="error" :empty="Boolean(data) && !data?.items.length" :empty-text="t('vendor.backups.empty')" @retry="refresh">
      <ul v-if="data?.items.length" class="divide-y divide-default" data-testid="backups-list">
        <li v-for="item in data.items" :key="item.backup_id" class="space-y-2 py-3" :data-backup="item.backup_id">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <NuxtLink :to="sharedJobLocation(item.job_id)" class="font-medium hover:underline">{{ formatLiwanDateTime(item.created_at) }}</NuxtLink>
            <span class="text-sm text-muted">{{ t('vendor.backups.startedBy', { name: item.started_by ?? t('vendor.common.unknown') }) }}</span>
          </div>
          <p v-if="item.approval" class="text-sm text-muted" data-testid="backup-approval">
            {{ t('vendor.backups.approvalOpen', { time: formatLiwanDateTime(item.approval.expires_at) }) }}
            <template v-if="item.approval.approved_by"> {{ t('vendor.backups.approvedBy', { name: item.approval.approved_by }) }}</template>
          </p>
          <ul v-if="item.restores.length" class="space-y-1" data-testid="backup-restores">
            <li v-for="restore in item.restores" :key="restore.job_id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <NuxtLink :to="sharedJobLocation(restore.job_id)" class="hover:underline">{{ t('vendor.backups.restoreCopy', { time: formatLiwanDateTime(restore.created_at) }) }}</NuxtLink>
              <SharedStatusBadge :tone="statusBadge(restore.state).tone" :label="statusBadge(restore.state).labelKey ? t(statusBadge(restore.state).labelKey) : restore.state" />
            </li>
          </ul>
        </li>
      </ul>
    </SharedPageState>
    <template v-if="data">
      <UAlert v-if="refusal" color="neutral" variant="subtle" icon="i-lucide-info" :title="t(refusal)" data-testid="backups-start-refusal">
        <template v-if="blockingJob" #actions><UButton :to="sharedJobLocation(blockingJob)" color="neutral" variant="outline" size="sm">{{ t('vendor.backups.viewBlocking') }}</UButton></template>
      </UAlert>
      <form v-if="data.start.allowed" class="mt-4 grid gap-3" data-testid="backup-start" novalidate @submit.prevent="confirmStart = canStart">
        <UAlert v-if="startError" color="error" variant="subtle" :title="t(sharedBackupErrorKey(startError))" data-testid="backup-start-error" />
        <UFormField :label="t('vendor.backups.reason')" required><UTextarea v-model="startReason" maxlength="1000" class="w-full" :disabled="startBusy" /></UFormField>
        <p v-if="!can('vendor.operations.run')" class="text-sm text-muted">{{ t('vendor.backups.needsPermission') }}</p>
        <SharedInlineConfirm v-if="confirmStart" color="warning" :title="t('vendor.backups.confirmStart')" :description="t('vendor.backups.outage')" :confirm-label="t('vendor.backups.start')" :pending="startBusy" :disabled="!canStart" @cancel="confirmStart = false" @confirm="startBackup" />
        <div v-else><UButton type="submit" icon="i-lucide-database-backup" :disabled="!canStart">{{ t('vendor.backups.start') }}</UButton></div>
      </form>
    </template>
  </SharedRecordSection>
</template>
