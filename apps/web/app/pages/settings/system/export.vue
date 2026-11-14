<script setup lang="ts">
import TenantExportPanel from '@/components/settings/TenantExportPanel.vue'
import { useTenantExport } from '@/composables/useTenantExport'
import { exportErrorKey, isBranchIdentity } from '@/utils/tenantExport'

// The tenant data export (system administrator, root company). A user without the capability sees the forbidden state and
// a branch session sees "belongs to the main company"; neither sends a request. It stays open while the tenant is
// read-only: the server serves the export as a read.
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const allowed = computed(() => can('tenant.export'))
const inBranch = computed(() => isBranchIdentity(me.value))
const { list, request, download } = useTenantExport(() => !!me.value && allowed.value && !inBranch.value)
const failure = ref<string>('')
const downloadingId = ref<number | null>(null)
const explain = (error: unknown) => t(`settings.tenantExport.errors.${exportErrorKey(error)}`)
async function requestExport() {
  failure.value = ''
  try { await request.mutateAsync() } catch (error) { failure.value = explain(error) }
}
async function downloadExport(id: number) {
  failure.value = ''
  downloadingId.value = id
  try { await download.mutateAsync(id) } catch (error) { failure.value = t('settings.tenantExport.errors.download', { reason: explain(error) }) } finally { downloadingId.value = null }
}
</script>

<template>
  <SharedListPage :title="t('settings.tenantExport.title')" :description="t('settings.tenantExport.description')" back-to="/settings/system">
    <SharedForbiddenState v-if="!allowed" :description="t('settings.tenantExport.forbidden')" />
    <SharedEmptyState v-else-if="inBranch" :title="t('settings.tenantExport.branch.title')" :description="t('settings.tenantExport.branch.description')" data-testid="tenant-export-branch" />
    <TenantExportPanel
      v-else
      :exports="list.data.value?.items ?? []"
      :retention-days="list.data.value?.retention_days"
      :next-export-at="list.data.value?.next_request_at"
      :cooldown-hours="list.data.value?.cooldown_hours"
      :timezone="me?.tz || 'Asia/Riyadh'"
      :loading="list.isLoading.value"
      :error="list.error.value"
      :requesting="request.isPending.value"
      :downloading-id="downloadingId"
      :action-error="failure"
      @request="requestExport"
      @download="downloadExport"
      @retry="list.refetch()"
    />
  </SharedListPage>
</template>
