<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import type { HrDocument } from '@/composables/useHrDocuments'
import { useHrDocuments } from '@/composables/useHrDocuments'
import { returnToQuery } from '@/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const props = withDefaults(defineProps<{ departmentId: number; canWrite: boolean; embedded?: boolean }>(), { embedded: false })
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
const hasActiveFilters = computed(() => activeFilterCount.value > 0)
function formatDocumentDate(value: string) {
  return formatCalendarDate(value, locale.value) || '—'
}

const columns = computed<TableColumn<HrDocument>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('hr.docs.columns.name') },
  { accessorKey: 'write_date', header: t('hr.docs.columns.updated') },
])

watch(() => [route.query.q, route.query.offset], ([q, nextOffset]) => {
  search.value = String(q ?? '')
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => { if (value !== String(route.query.q ?? '')) updateSearch() })
function updateSearch() {
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), offset: undefined } })
}
function clearSearch() {
  search.value = ''
  updateSearch()
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || hasPendingSearch.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, ...(offset.value ? { offset: offset.value } : { offset: undefined }) } })
}
function detailsTo(document: HrDocument) {
  return { path: `/hr/departments/${document.department.id}/documents/${document.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <section class="space-y-3">
    <div class="w-full min-w-0">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearSearch">
        <template #search>
          <UInput v-model="search" class="min-w-52 flex-1" :disabled="!hydrated" :placeholder="t('hr.docs.search')" icon="i-lucide-search" @change="updateSearch" />
        </template>
        <template #actions>
          <UButton v-if="canWriteAllowed" color="primary" :disabled="!hydrated" icon="i-lucide-plus" :label="t('hr.docs.new')" :to="{ path: `/hr/departments/${props.departmentId}/documents/new`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()" />
        </template>
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip :label="t('hr.directory.searchValue', { value: search })" @remove="clearSearch" />
          </div>
        </template>
      </FilterBar>
    </div>
    <div class="min-w-0 space-y-2">
      <UCard class="nasq-ui-record-surface hidden overflow-hidden md:block" :class="props.embedded ? 'ring-0 border-0 shadow-none rounded-none' : ''" :ui="{ body: 'p-0' }">
        <div v-if="query.isLoading.value" class="divide-y divide-default" role="status" :aria-label="t('app.loading')">
          <div v-for="n in 3" :key="n" class="flex items-center gap-4 px-4 py-3">
            <USkeleton class="h-5 w-20" /><USkeleton class="h-5 flex-1" /><USkeleton class="h-5 w-24" />
          </div>
        </div>
        <div v-else-if="items.length === 0" class="p-6"><SharedEmptyState :title="t('hr.docs.empty')" /></div>
        <div v-else class="overflow-x-auto">
          <UTable :data="items" :columns="columns" :caption="t('hr.docs.title')" :ui="{ caption: 'sr-only', th: 'nasq-ui-table-head' }" @select="(_event, row) => navigateTo(detailsTo(row.original))">
            <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">{{ row.original.name }}</template>
            <template #write_date-cell="{ row }"><span class="text-muted">{{ formatDocumentDate(row.original.write_date) }}</span></template>
          </UTable>
        </div>
      </UCard>
      <div v-if="query.isLoading.value" class="md:hidden space-y-2">
        <USkeleton v-for="n in 3" :key="n" class="h-16 w-full rounded-lg" />
      </div>
      <div v-else-if="items.length === 0" class="md:hidden"><SharedEmptyState :title="t('hr.docs.empty')" /></div>
      <ul v-else class="md:hidden space-y-2" :aria-label="t('hr.docs.title')">
        <li v-for="document in items" :key="document.id" class="cursor-pointer nasq-ui-record-surface p-4" tabindex="0" role="button" @click="navigateTo(detailsTo(document))" @keydown.enter.self="navigateTo(detailsTo(document))" @keydown.space.self.prevent="navigateTo(detailsTo(document))">
          <bdi class="block text-xs text-muted">#{{ document.id }}</bdi>
          <p class="font-medium">{{ document.name }}</p>
          <p class="mt-1 text-xs text-muted">{{ formatDocumentDate(document.write_date) }}</p>
        </li>
      </ul>
    </div>
    <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted">
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" :label="t('access.previousPage')" @click="setPage(page - 1)" />
      <span>{{ t('access.pageOf', { page, pages }) }}</span>
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" :label="t('access.nextPage')" @click="setPage(page + 1)" />
    </div>
  </section>
</template>
