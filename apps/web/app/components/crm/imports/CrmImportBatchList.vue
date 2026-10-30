<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CrmImportBatch } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useCrmImportBatches } from '@/composables/crm/useCrmImports'
import { listPageNumber } from '@/composables/useRouteListFilters'

// The imported files of the company, newest first, with what each one created, skipped and left without an agent.
// `background` is the list behind the import panel: it always shows the first page and writes nothing to the address.
const props = defineProps<{ background?: boolean }>()
const PAGE_SIZE = 20
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const page = computed(() => (props.background ? 1 : listPageNumber(route.query.page)))
const query = useCrmImportBatches(() => ({ limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE }))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const goTo = (value: number) => { if (hydrated.value) void router.replace({ query: { ...route.query, page: value > 1 ? String(value) : undefined } }) }

const numberColumn = (id: string, header: string): TableColumn<CrmImportBatch> => ({ id, header, meta: { class: { th: 'text-start w-[96px]', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<CrmImportBatch>['meta'] })
const columns = computed<TableColumn<CrmImportBatch>[]>(() => [
  { id: 'file', header: t('crm.imports.cols.file'), meta: { class: { th: 'text-start min-w-[200px]', td: 'max-w-0' } } as TableColumn<CrmImportBatch>['meta'] },
  { id: 'date', header: t('crm.imports.cols.date'), meta: { class: { th: 'text-start w-[170px]', td: 'whitespace-nowrap' } } as TableColumn<CrmImportBatch>['meta'] },
  { id: 'by', header: t('crm.imports.cols.by'), meta: { class: { th: 'text-start w-[150px]', td: 'whitespace-nowrap' } } as TableColumn<CrmImportBatch>['meta'] },
  { id: 'source', header: t('crm.imports.cols.source'), meta: { class: { th: 'text-start w-[130px]', td: 'whitespace-nowrap' } } as TableColumn<CrmImportBatch>['meta'] },
  numberColumn('created', t('crm.imports.cols.created')),
  numberColumn('duplicate', t('crm.imports.cols.duplicate')),
  numberColumn('invalid', t('crm.imports.cols.invalid')),
  numberColumn('unassigned', t('crm.imports.cols.unassigned')),
])
</script>

<template>
  <SharedForbiddenState v-if="!can('crm.leads.import')" />
  <SharedListCard v-else-if="hydrated" data-testid="crm-import-batches">
    <SharedPageState v-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="t('crm.imports.empty')" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,900px)] [&_table]:table-fixed">
      <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :loading="query.isPending.value" :caption="t('crm.nav.imports')">
        <template #file-cell="{ row }"><span class="block truncate font-semibold text-highlighted" :title="row.original.file_name"><bdi>{{ row.original.file_name }}</bdi></span></template>
        <template #date-cell="{ row }"><time class="text-sm" :datetime="row.original.created_at">{{ formatDateTime(row.original.created_at) }}</time></template>
        <template #by-cell="{ row }"><span class="text-sm">{{ row.original.user?.name }}</span></template>
        <template #source-cell="{ row }"><span class="text-sm">{{ row.original.source?.name }}</span></template>
        <template #created-cell="{ row }"><span class="text-sm">{{ row.original.created }}</span></template>
        <template #duplicate-cell="{ row }"><span class="text-sm">{{ row.original.duplicate }}</span></template>
        <template #invalid-cell="{ row }"><span class="text-sm">{{ row.original.invalid }}</span></template>
        <template #unassigned-cell="{ row }"><span class="text-sm">{{ row.original.unassigned }}</span></template>
        <template #mobile-row="{ row }">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="truncate font-semibold text-highlighted"><bdi>{{ row.file_name }}</bdi></span>
            <time class="text-sm text-muted" :datetime="row.created_at">{{ formatDateTime(row.created_at) }}</time>
            <span class="text-sm text-muted">{{ t('crm.imports.cols.created') }} {{ row.created }} · {{ t('crm.imports.cols.duplicate') }} {{ row.duplicate }} · {{ t('crm.imports.cols.invalid') }} {{ row.invalid }}</span>
          </div>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="!query.error.value && items.length" #footer>
      <SharedListFooter :count-label="t('crm.imports.results', { shown: items.length, total })" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value || background" @update:page="goTo" />
    </template>
  </SharedListCard>
</template>
