<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { exportFailureKey, exportInProgress, exportProgress, exportRowsTotal, exportStateTone, exportWaiting, type TenantExport } from '@/utils/tenantExport'

// The tenant data export: what the copy holds, the one request action and the list of past exports with their state.
// The page owns the requests; this panel only draws them and says what the user pressed.
const props = defineProps<{
  exports: TenantExport[]
  /** From the server's answer; the sentence is left out until it is known. */
  retentionDays?: number
  /** When the next export becomes possible (24 hours after the last finished one); absent when none is waiting. */
  nextExportAt?: string | null
  cooldownHours?: number
  timezone: string
  loading?: boolean
  error?: unknown
  requesting?: boolean
  downloadingId?: number | null
  /** The reason the last request or download was refused, already in the user's language. */
  actionError?: string
}>()
const emit = defineEmits<{ request: []; download: [id: number]; retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const busy = computed(() => exportInProgress(props.exports))
// The wait is judged in the browser only, so the server and client markup match.
const now = ref<number | null>(null)
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { now.value = Date.now(); tick = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => clearInterval(tick))
const waiting = computed(() => now.value !== null && exportWaiting(props.nextExportAt, now.value))
const columns = computed<TableColumn<TenantExport>[]>(() => [
  { accessorKey: 'state', header: t('settings.tenantExport.columns.state') },
  { accessorKey: 'requested_at', header: t('settings.tenantExport.columns.requested') },
  { accessorKey: 'finished_at', header: t('settings.tenantExport.columns.finished') },
  { id: 'counts', header: t('settings.tenantExport.columns.contents') },
  { id: 'actions', header: t('settings.tenantExport.columns.actions') },
])
const time = (value: string | null) => formatDateTime(value, props.timezone) || t('settings.tenantExport.noDate')
const stateLabel = (state: TenantExport['state']) => t(`settings.tenantExport.states.${state}`)
const failureText = (job: TenantExport) => t(`settings.tenantExport.failures.${exportFailureKey(job.failure)}`)
const countsLabel = (counts: TenantExport['counts']) => counts
  ? t('settings.tenantExport.counts', { rows: exportRowsTotal(counts), files: counts.files })
  : ''
</script>

<template>
  <div class="grid gap-(--liwan-gap-card)" data-testid="tenant-export">
    <SharedRecordSection variant="panel" :title="t('settings.tenantExport.contents.title')">
      <div class="grid gap-3 text-sm">
        <ul class="list-disc space-y-1 ps-5">
          <li>{{ t('settings.tenantExport.contents.workbooks') }}</li>
          <li>{{ t('settings.tenantExport.contents.files') }}</li>
          <li>{{ t('settings.tenantExport.contents.manifest') }}</li>
          <li>{{ t('settings.tenantExport.contents.overflow') }}</li>
        </ul>
        <p>{{ t('settings.tenantExport.never') }}</p>
        <p class="text-muted">{{ t('settings.tenantExport.takesTime') }}<template v-if="retentionDays"> {{ t('settings.tenantExport.retention', { days: retentionDays }) }}</template></p>
        <div class="flex flex-wrap items-center gap-3">
          <UButton icon="i-lucide-archive" :disabled="!hydrated || busy || waiting || requesting" :loading="requesting" data-testid="tenant-export-request" @click="emit('request')">{{ t('settings.tenantExport.request') }}</UButton>
          <p v-if="busy" class="text-muted" data-testid="tenant-export-busy">{{ t('settings.tenantExport.busy') }}</p>
          <p v-else-if="waiting && nextExportAt" class="text-muted" data-testid="tenant-export-wait">{{ t('settings.tenantExport.nextAt', { time: time(nextExportAt), hours: cooldownHours }) }}</p>
        </div>
        <UAlert v-if="actionError" color="error" variant="subtle" role="alert" :title="actionError" data-testid="tenant-export-error" />
      </div>
    </SharedRecordSection>
    <SharedRecordSection variant="list" :title="t('settings.tenantExport.history')">
      <SharedEmptyState v-if="!loading && !error && !exports.length" class="m-(--liwan-card-pad)" :title="t('settings.tenantExport.empty')" data-testid="tenant-export-empty" />
      <SharedDataTable v-else bare :rows="exports" :columns="columns" row-key="id" :caption="t('settings.tenantExport.history')" :loading="loading" :error="error" @retry="emit('retry')">
        <template #state-cell="{ row }">
          <div class="grid gap-1">
            <SharedStatusBadge :tone="exportStateTone(row.original.state)" :label="stateLabel(row.original.state)" />
            <SharedProgress v-if="row.original.state === 'running' && exportProgress(row.original) !== null" size="sm" :value="exportProgress(row.original)" :label="t('settings.tenantExport.progress')" />
            <span v-if="row.original.state === 'failed' && row.original.failure" class="text-sm text-error">{{ failureText(row.original) }}</span>
          </div>
        </template>
        <template #requested_at-cell="{ row }">{{ time(row.original.requested_at) }}</template>
        <template #finished_at-cell="{ row }">{{ time(row.original.finished_at) }}</template>
        <template #counts-cell="{ row }">{{ countsLabel(row.original.counts) }}</template>
        <template #actions-cell="{ row }">
          <UButton v-if="row.original.downloadable" size="sm" color="neutral" variant="outline" icon="i-lucide-download" :disabled="!hydrated || downloadingId === row.original.id" :loading="downloadingId === row.original.id" data-testid="tenant-export-download" @click="emit('download', row.original.id)">{{ t('settings.tenantExport.download') }}</UButton>
        </template>
        <template #mobile-row="{ row }">
          <div class="grid min-w-0 gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <SharedStatusBadge :tone="exportStateTone(row.state)" :label="stateLabel(row.state)" />
              <span class="text-sm text-muted">{{ time(row.requested_at) }}</span>
            </div>
            <SharedProgress v-if="row.state === 'running' && exportProgress(row) !== null" size="sm" :value="exportProgress(row)" :label="t('settings.tenantExport.progress')" />
            <span v-if="row.state === 'failed' && row.failure" class="text-sm text-error">{{ failureText(row) }}</span>
            <span v-if="row.counts" class="text-sm text-muted">{{ countsLabel(row.counts) }}</span>
            <UButton v-if="row.downloadable" size="sm" color="neutral" variant="outline" icon="i-lucide-download" :disabled="!hydrated || downloadingId === row.id" :loading="downloadingId === row.id" data-testid="tenant-export-download" @click="emit('download', row.id)">{{ t('settings.tenantExport.download') }}</UButton>
          </div>
        </template>
      </SharedDataTable>
    </SharedRecordSection>
  </div>
</template>
