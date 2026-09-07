<script setup lang="ts">
import { Plus, Search } from '@lucide/vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import type { HrDocument } from '@/composables/useHrDocuments'
import { useHrDocuments } from '@/composables/useHrDocuments'
import { returnToQuery } from '@/utils/safeReturnTo'
import { refDebounced } from '@vueuse/core'
import { hasPendingHrSearch, hrCommittedListParams } from '@/composables/useHrSearch'

const props = defineProps<{ departmentId: number; canWrite: boolean }>()
const { t } = useI18n()
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

watch(() => [route.query.q, route.query.offset], ([q, nextOffset]) => {
  search.value = String(q ?? '')
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => { if (value !== String(route.query.q ?? '')) updateSearch() })
function updateSearch() {
  offset.value = 0
  void router.replace({ query: { ...route.query, ...(search.value.trim() ? { q: search.value.trim() } : { q: undefined }), offset: undefined } })
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
    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <div class="relative min-w-52 flex-1">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" :disabled="!hydrated" :placeholder="t('hr.docs.search')" class="ps-8" @change="updateSearch" />
          </div>
        </template>
        <template #default>
          <NuxtLink v-if="canWriteAllowed" :to="{ path: `/hr/departments/${props.departmentId}/documents/new`, query: returnToQuery(route.fullPath) }">
            <Button :disabled="!hydrated" class="gap-2"><Plus class="size-[18px]" />{{ t('hr.docs.new') }}</Button>
          </NuxtLink>
        </template>
      </FilterBar>
    </div>
    <div class="nasq-panel overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead class="text-start">{{ t('hr.docs.columns.name') }}</TableHead><TableHead class="text-start">{{ t('hr.docs.columns.updated') }}</TableHead></TableRow></TableHeader>
        <TableBody>
          <template v-if="query.isLoading.value"><TableRow v-for="n in 3" :key="n"><TableCell><Skeleton class="h-5 w-full" /></TableCell><TableCell><Skeleton class="h-5 w-24" /></TableCell></TableRow></template>
          <TableEmpty v-else-if="items.length === 0" :colspan="2"><p class="text-muted-foreground">{{ t('hr.docs.empty') }}</p></TableEmpty>
          <template v-else><TableRow v-for="document in items" :key="document.id" class="cursor-pointer transition-colors hover:bg-muted/50" @click="navigateTo(detailsTo(document))"><TableCell class="text-start">{{ document.name }}</TableCell><TableCell class="text-start text-muted-foreground">{{ new Date(document.write_date).toLocaleDateString() }}</TableCell></TableRow></template>
        </TableBody>
      </Table>
    </div>
    <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground"><Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="setPage(page - 1)">{{ t('access.previousPage') }}</Button><span>{{ t('access.pageOf', { page, pages }) }}</span><Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="setPage(page + 1)">{{ t('access.nextPage') }}</Button></div>
  </section>
</template>
