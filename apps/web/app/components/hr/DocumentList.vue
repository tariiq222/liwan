<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import type { HrDocument } from '@/composables/useHrDocuments'
import { useHrDocuments } from '@/composables/useHrDocuments'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const props = defineProps<{ departmentId: number; canWrite: boolean }>()
const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canWriteAllowed = computed(() => props.canWrite && can('hr.documents.manage'))
const route = useRoute()
const router = useRouter()
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const hasPendingSearch = computed(() => hasPendingHrSearch(search.value, route.query.q))
const committedListParams = computed(() => hrCommittedListParams(route.query))
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => ({ q: committedListParams.value.q, department_id: props.departmentId, limit, offset: committedListParams.value.offset }))
const query = useHrDocuments(params)
const items = computed<HrDocument[]>(() => query.data.value?.items ?? [])
const page = computed(() => Math.floor(committedListParams.value.offset / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
const total = computed(() => query.data.value?.total ?? 0)
const showEmpty = computed(() => !query.isLoading.value && !query.error.value && items.value.length === 0)
function formatDocumentDate(value: string) {
  return formatCalendarDate(value, locale.value) || '—'
}

const columns = computed<TableColumn<HrDocument>[]>(() => [
  { accessorKey: 'name', header: t('hr.docs.columns.name') },
  { accessorKey: 'write_date', header: t('hr.docs.columns.updated') },
])

watch(() => [route.query.q, route.query.offset], ([q, nextOffset]) => {
  search.value = String(q ?? '')
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => { if (value !== String(route.query.q ?? '')) updateSearch() })
function updateSearch() {
  if (!/^\/hr\/departments\/[^/]+$/.test(route.path.replace(/\/+$/, '') || '/')) return
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), offset: undefined } })
}
function clearSearch() {
  search.value = ''
  updateSearch()
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  if (!/^\/hr\/departments\/[^/]+$/.test(route.path.replace(/\/+$/, '') || '/')) return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, ...(offset.value ? { offset: offset.value } : { offset: undefined }) } })
}
function detailsTo(document: HrDocument) {
  return { path: `/hr/departments/${document.department.id}/documents/${document.id}`, query: returnToQuery(route.fullPath) }
}
function rowTo(document: HrDocument) { return detailsTo(document) }
</script>

<template>
  <SharedListCard>
    <template #filters>
      <div class="w-full min-w-0">
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearSearch">
          <template #search>
            <UInput v-model="search" class="min-w-48 flex-1" :disabled="!hydrated" :placeholder="t('hr.docs.search')" :aria-label="t('hr.docs.search')" icon="i-lucide-search" @change="updateSearch">
              <template v-if="search" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('hr.docs.clearSearch')" class="-me-1" @click="clearSearch" />
              </template>
            </UInput>
          </template>
          <template #actions>
            <UButton v-if="canWriteAllowed" color="primary" :disabled="!hydrated" icon="i-lucide-plus" :label="t('hr.docs.new')" :to="{ path: `/hr/departments/${props.departmentId}/documents/new`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()" />
          </template>
        </FilterBar>
      </div>
    </template>
    <SharedPageState :error="query.error.value" :keep-content="items.length > 0" @retry="query.refetch">
      <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hr.docs.empty')" />
      <SharedDataTable
        v-else
        bare
        :rows="items"
        :columns="columns"
        row-key="id"
        :row-to="rowTo"
        :loading="query.isLoading.value"
        :caption="t('hr.docs.title')"
      >
        <template #name-cell="{ row }"><NuxtLink :to="detailsTo(row.original)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :title="row.original.name">{{ row.original.name }}</NuxtLink></template>
        <template #write_date-cell="{ row }"><span class="text-muted">{{ formatDocumentDate(row.original.write_date) }}</span></template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="detailsTo(row)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.name }}</NuxtLink>
          <p class="mt-1 text-xs text-muted">{{ formatDocumentDate(row.write_date) }}</p>
        </template>
      </SharedDataTable>
    </SharedPageState>
    <template v-if="query.data.value && !showEmpty" #footer>
      <SharedListFooter :count-label="t('hr.docs.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
    </template>
  </SharedListCard>
</template>
