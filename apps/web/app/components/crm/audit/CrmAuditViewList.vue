<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CrmViewLog } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { CRM_AUDIT_PAGE_SIZE, CRM_AUDIT_PATH, useCrmAuditAccess, useCrmViewLogs } from '@/composables/crm/useCrmAudit'
import { useCrmTerms } from '@/composables/crm/useCrmTerms'
import { useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'

// The read-only list of the CRM view log: who opened which opportunity, newest first. The page owns the list shell.
const { t } = useI18n()
const { me } = useMe()
const { term } = useCrmTerms()
const timeZone = computed(() => me.value?.tz || 'UTC')
const allowed = useCrmAuditAccess()
const { hydrated, page, update } = useRouteListFilters({
  fallbackPath: () => CRM_AUDIT_PATH,
  safeReturnTo: (value, fallback) => safeReturnTo(value, fallback, [CRM_AUDIT_PATH]),
})
const query = useCrmViewLogs(page, allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / CRM_AUDIT_PAGE_SIZE)))
useLastPageClamp({ page: () => page.value, total: () => query.data.value?.total, pageSize: CRM_AUDIT_PAGE_SIZE })
const showEmpty = computed(() => !query.isPending.value && !query.error.value && items.value.length === 0)
const time = (log: CrmViewLog) => formatDateTime(log.viewed_at, timeZone.value)

const columns = computed<TableColumn<CrmViewLog>[]>(() => [
  { id: 'user', header: t('crm.audit.cols.user') },
  { id: 'opportunity', header: term('opportunity', 'one') },
  { id: 'viewed_at', header: t('crm.audit.cols.viewedAt') },
])
</script>

<template>
  <SharedForbiddenState v-if="!allowed" />
  <SharedListCard v-else>
    <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch()">
      <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('crm.audit.empty')" />
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,560px)]">
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('crm.audit.title')">
          <template #user-cell="{ row }"><span class="text-sm text-highlighted">{{ row.original.user.name }}</span></template>
          <template #opportunity-cell="{ row }">
            <NuxtLink :to="`/crm/opportunities/${row.original.opportunity_id}`" class="text-sm font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <bdi class="tabular-nums">#{{ row.original.opportunity_id }}</bdi>
            </NuxtLink>
          </template>
          <template #viewed_at-cell="{ row }"><time class="whitespace-nowrap text-sm tabular-nums" :datetime="row.original.viewed_at">{{ time(row.original) }}</time></template>
          <template #mobile-row="{ row }">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="truncate font-semibold text-highlighted">{{ row.user.name }}</span>
              <NuxtLink :to="`/crm/opportunities/${row.opportunity_id}`" class="text-sm hover:underline"><bdi class="tabular-nums">#{{ row.opportunity_id }}</bdi></NuxtLink>
              <time class="text-sm tabular-nums text-muted" :datetime="row.viewed_at">{{ time(row) }}</time>
            </div>
          </template>
        </SharedDataTable>
      </div>
    </SharedPageState>
    <template v-if="query.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('crm.audit.footer', { shown: items.length, total })" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
    </template>
  </SharedListCard>
</template>
