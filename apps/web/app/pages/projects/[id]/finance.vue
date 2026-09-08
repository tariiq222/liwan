<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import FinanceEntryTable from '@/components/project/finance/FinanceEntryTable.vue'
import FinanceSummaryCards from '@/components/project/finance/FinanceSummaryCards.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import {
  FINANCE_PAGE,
  FINANCE_RETURN_PREFIXES,
  parseFinanceKind,
  parseFinanceListRoute,
  parsePositiveId,
  patchFinanceListRoute,
  nextOffsetAfterListResult,
  sameFinanceListRoute,
  serializeFinanceListRoute,
  type FinanceListRouteState,
} from '@/utils/projectFinance'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const projectId = computed(() => parsePositiveId(route.params.id))
const isListRoute = computed(() => {
  const id = projectId.value
  if (id == null) return !normalizedPath.value.includes('/finance/')
  return normalizedPath.value === `/projects/${id}/finance`
})

const filters = reactive<FinanceListRouteState>(parseFinanceListRoute(route.query as Record<string, unknown>))
const search = ref(filters.q)
const debouncedSearch = refDebounced(search, 250)
let applyingRoute = false
let writeQuery: Promise<void> = Promise.resolve()

const listFilters = computed(() => ({
  kind: filters.kind,
  q: filters.q.trim() || undefined,
  limit: FINANCE_PAGE,
  offset: filters.offset,
}))
const list = useProjectFinanceList(computed(() => isListRoute.value ? projectId.value : null), listFilters)
const canManage = computed(() => list.data.value?.can_manage === true)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const summary = computed(() => list.data.value?.summary)
const page = computed(() => Math.floor(filters.offset / FINANCE_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / FINANCE_PAGE)))
const filtered = computed(() => Boolean(filters.q.trim()) || filters.kind !== 'all')
const notFound = computed(() => projectId.value === null || (list.error.value instanceof ApiError && [403, 404].includes(list.error.value.status)))
const projectFallback = computed(() => projectId.value ? `/projects/${projectId.value}` : '/projects')
const returnTo = computed(() => safeReturnTo(route.query.returnTo, projectFallback.value, FINANCE_RETURN_PREFIXES))

function applyPatch(patch: Partial<FinanceListRouteState>) {
  Object.assign(filters, patchFinanceListRoute(filters, patch))
}

function scheduleQueryWrite() {
  writeQuery = writeQuery.then(async () => {
    if (!isListRoute.value) return
    const query = serializeFinanceListRoute(filters)
    if (sameFinanceListRoute(query, serializeFinanceListRoute(parseFinanceListRoute(route.query as Record<string, unknown>)))) return
    applyingRoute = true
    try {
      const context = Object.fromEntries(
        ['returnTo', 'taskContext', 'projectListReturnTo']
          .filter(key => typeof route.query[key] === 'string')
          .map(key => [key, route.query[key] as string]),
      )
      await router.replace({ query: { ...query, ...context } })
    }
    finally {
      applyingRoute = false
    }
  }).catch(() => undefined)
}

watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch([() => filters.kind, () => filters.q, () => filters.offset], () => {
  scheduleQueryWrite()
})
watch(() => route.query, (query) => {
  if (applyingRoute || !isListRoute.value) return
  const parsed = parseFinanceListRoute(query as Record<string, unknown>)
  if (sameFinanceListRoute(serializeFinanceListRoute(filters), serializeFinanceListRoute(parsed))) return
  applyingRoute = true
  search.value = parsed.q
  Object.assign(filters, parsed)
  queueMicrotask(() => { applyingRoute = false })
})
watch(
  () => ({
    fetching: list.isFetching.value,
    offset: filters.offset,
    queryOffset: listFilters.value.offset,
    total: list.data.value?.total,
  }),
  ({ fetching, offset, queryOffset, total }) => {
    if (!isListRoute.value) return
    const next = nextOffsetAfterListResult({
      isFetching: fetching,
      requestedOffset: offset,
      responseOffset: queryOffset,
      total,
      pageSize: FINANCE_PAGE,
    })
    if (next === null) return
    applyPatch({ offset: next })
  },
)

function onKindChange(value: unknown) {
  applyPatch({ kind: parseFinanceKind(value) })
}

function setPage(next: number) {
  if (!hydrated.value || list.isFetching.value || next < 1 || next > pages.value) return
  applyPatch({ offset: (next - 1) * FINANCE_PAGE })
}

function openEntry(id: number) {
  if (!projectId.value) return
  void router.push({ path: `/projects/${projectId.value}/finance/${id}`, query: returnToQuery(route.fullPath) })
}

function newQuery(kind: 'budget' | 'expense') {
  return { kind, ...returnToQuery(route.fullPath) }
}

function financeChildKey(target: { path: string; params: Record<string, string | string[]> }) {
  const project = Array.isArray(target.params.id) ? target.params.id[0] : target.params.id
  const entry = Array.isArray(target.params.entryId) ? target.params.entryId[0] : target.params.entryId
  if (entry) return `finance-entry-${project}-${entry}`
  if (target.path.includes('/finance/new')) return `finance-new-${project}`
  return target.path
}
</script>

<template>
  <SharedPageContainer v-if="isListRoute" width="list" data-testid="project-finance-page">
    <SharedPageHeader
      :title="t('projects.finance.title')"
      :description="t('projects.finance.description')"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    >
      <template #actions>
        <template v-if="canManage && projectId">
          <NuxtLink :to="{ path: `/projects/${projectId}/finance/new`, query: newQuery('budget') }" @click="!hydrated && $event.preventDefault()">
            <Button :disabled="!hydrated" class="gap-2">
              <Plus class="size-[18px]" />{{ t('projects.finance.newBudget') }}
            </Button>
          </NuxtLink>
          <NuxtLink :to="{ path: `/projects/${projectId}/finance/new`, query: newQuery('expense') }" @click="!hydrated && $event.preventDefault()">
            <Button variant="outline" :disabled="!hydrated" class="gap-2">
              <Plus class="size-[18px]" />{{ t('projects.finance.newExpense') }}
            </Button>
          </NuxtLink>
        </template>
      </template>
    </SharedPageHeader>
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="list.isLoading.value && !list.data.value"
      :error="notFound ? null : list.error.value"
      :empty="false"
      @retry="list.refetch"
    >
      <p v-if="notFound && !list.isLoading.value" class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <template v-else>
        <FinanceSummaryCards v-if="summary && projectId" :project-id="projectId" :summary="summary" />
        <div class="nasq-toolbar">
          <FilterBar class="w-full">
            <template #search>
              <Input v-model="search" :disabled="!hydrated" :placeholder="t('projects.finance.search')" :aria-label="t('projects.finance.search')" data-testid="finance-search" class="min-w-52" />
            </template>
            <template #view>
              <Tabs :model-value="filters.kind" data-testid="finance-kind-filter" @update:model-value="onKindChange">
                <TabsList>
                  <TabsTrigger value="all" :disabled="!hydrated">{{ t('projects.finance.kind.all') }}</TabsTrigger>
                  <TabsTrigger value="budget" :disabled="!hydrated">{{ t('projects.finance.kind.budget') }}</TabsTrigger>
                  <TabsTrigger value="expense" :disabled="!hydrated">{{ t('projects.finance.kind.expense') }}</TabsTrigger>
                </TabsList>
              </Tabs>
            </template>
          </FilterBar>
        </div>
        <FinanceEntryTable
          v-if="summary"
          :project-id="projectId"
          :items="items"
          :summary="summary"
          :is-loading="list.isLoading.value"
          :filtered="filtered"
          @open="openEntry"
        />
        <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
          <Button variant="ghost" :disabled="!hydrated || page === 1 || list.isFetching.value" @click="setPage(page - 1)">{{ t('projects.previousPage') }}</Button>
          <span>{{ t('projects.pageOf', { page, pages }) }}</span>
          <Button variant="ghost" :disabled="!hydrated || page >= pages || list.isFetching.value" @click="setPage(page + 1)">{{ t('projects.nextPage') }}</Button>
        </div>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <KeepAlive>
    <NuxtPage :page-key="financeChildKey" />
  </KeepAlive>
</template>
