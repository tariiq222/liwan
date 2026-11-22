<script setup lang="ts">
import { formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { operationStatusBadge } from '@/utils/vendorBadges'
import { sharedJobLocation, startRefusalKey } from '@/utils/sharedBackups'
import { useSharedBackups } from '@/composables/useSharedBackups'
const props = defineProps<{ tenantId: string }>()
const { t } = useI18n()
const { data, error, pending, refresh } = useSharedBackups(toRef(props, 'tenantId'))
const refusal = computed(() => (data.value ? startRefusalKey(data.value.start) : null))
const blockingJob = computed(() => (data.value && !data.value.start.allowed ? data.value.start.job_id : null))
const statusBadge = (state: string) => operationStatusBadge(state)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('vendor.backups.title')" :description="t('vendor.backups.hint')" data-testid="backups-panel">
    <SharedPageState :loading="pending && !data" :error="error" :empty="Boolean(data) && !data?.items.length" :empty-text="t('vendor.backups.empty')" @retry="refresh">
      <UAlert v-if="refusal" color="neutral" variant="subtle" icon="i-lucide-info" :title="t(refusal)" data-testid="backups-start-refusal">
        <template v-if="blockingJob" #actions><UButton :to="sharedJobLocation(blockingJob)" color="neutral" variant="outline" size="sm">{{ t('vendor.backups.viewBlocking') }}</UButton></template>
      </UAlert>
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
  </SharedRecordSection>
</template>
