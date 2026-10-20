<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { z } from 'zod'
import type { MeetingPreviousResolutionSchema } from '@webvue/contracts'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { refDebounced } from '@vueuse/core'
import { useMeetingFollowup, type MeetingFollowupParams } from '@/composables/useMeetingWorkspace'
import { useMeetingFollowupKpis } from '@/composables/useMeetingKpis'
import { formatMeetingDate } from '@/utils/meetingMinutesForm'
import { resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { parseOffset, firstQuery } from '@/utils/routeQuery'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

type Row = z.infer<typeof MeetingPreviousResolutionSchema>
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const states = ['all', 'active', 'overdue', 'open', 'in_progress', 'done', 'cancelled'] as const
const filters = computed(() => ({
  q: firstQuery(route.query.q) ?? '',
  mine: route.query.mine === '1',
  state: states.includes(firstQuery(route.query.state) as typeof states[number]) ? firstQuery(route.query.state) as typeof states[number] : 'active' as const,
  offset: parseOffset(route.query.offset),
}))
const search = ref(filters.value.q)
const debouncedSearch = refDebounced(search, 250)
watch(() => route.query.q, () => { search.value = filters.value.q })
function patch(values: Record<string, string | undefined>) {
  void router.replace({ path: '/meetings/follow-up', query: { ...route.query, offset: undefined, ...values } })
}
watch(debouncedSearch, value => { if (route.path === '/meetings/follow-up' && value.trim() !== filters.value.q) patch({ q: value.trim() || undefined }) })
const limit = 25
const query = useMeetingFollowup(computed<MeetingFollowupParams>(() => ({ ...filters.value, state: filters.value.state === 'all' ? undefined : filters.value.state, limit })))
// The tiles count under the search and "mine" scope; each tile brings its own state.
const kpis = useMeetingFollowupKpis(() => ({ q: filters.value.q, mine: filters.value.mine }), kpisShown)
const rows = computed(() => query.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const page = computed(() => Math.floor(filters.value.offset / limit) + 1)
const stateOptions = computed(() => states.map(value => ({ value, label: value === 'all' ? t('meetingsUi.allStates') : value === 'active' || value === 'overdue' ? t(value === 'active' ? 'meetingTimeline.activeFollowup' : 'meetingTimeline.overdueFollowup') : t(`meetingsUi.resolutionState.${value}`) })))
const scopeItems = computed(() => [
  { value: 'all', label: t('meetingsUx.followupAll') },
  { value: 'mine', label: t('meetingsUx.followupMine') },
])
const activeFilterCount = computed(() => [search.value.trim(), filters.value.mine, filters.value.state !== 'active'].filter(Boolean).length)
function clearFilters() {
  search.value = ''
  patch({ q: undefined, mine: undefined, state: undefined })
}
const total = computed(() => query.data.value?.total ?? 0)
const columns = computed<TableColumn<Row>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2 text-start', td: 'w-12 px-2 whitespace-nowrap' } } },
  { accessorKey: 'name', header: t('meetingsUi.resolutionTitle'), meta: { class: { th: 'w-2/5', td: 'max-w-0' } } },
  { accessorKey: 'responsible', header: t('meetingsUi.responsible') },
  { accessorKey: 'deadline', header: t('meetingsUi.deadline') },
  { accessorKey: 'execution_state', header: t('meetingsUi.stateLabel') },
  { id: 'task', header: t('meetingsUx.openTaskNewTab') },
])
function meetingTo(row: Row) {
  const origin = router.resolve({ path: '/meetings/follow-up', query: { ...route.query, q: search.value.trim() || undefined } }).fullPath
  return { path: `/meetings/${row.meeting_id}`, query: { ...returnToQuery(origin), tab: 'resolutions' } }
}
function setPage(value: number) { if (value >= 1 && value <= pages.value) patch({ offset: value > 1 ? String((value - 1) * limit) : undefined }) }
</script>

<template>
  <SharedListPage :title="t('nav.meetingFollowup')" kpi-toggle>
    <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('meetingsKpi.label')" data-testid="meeting-followup-kpi-strip" />
    <SharedListCard>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput id="followup-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsUx.followupSearch')" :aria-label="t('meetingsUx.followupSearch')">
              <template v-if="search" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="search = ''" />
              </template>
            </UInput>
          </template>
          <template #default>
            <USelect class="w-full md:w-48" icon="i-lucide-activity" :items="stateOptions" :model-value="filters.state" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @update:model-value="patch({ state: String($event) })" />
          </template>
          <template #view>
            <SharedSegmentedControl :label="t('meetingsUi.responsible')" :items="scopeItems" :model-value="filters.mine ? 'mine' : 'all'" :disabled="!hydrated" @update:model-value="patch({ mine: $event === 'mine' ? '1' : undefined })" />
          </template>
        </FilterBar>
      </template>
      <SharedDataTable bare :rows="rows" :columns="columns" row-key="id" :row-to="meetingTo" :loading="query.isLoading.value" :error="query.error.value" :empty-text="t(activeFilterCount ? 'app.noResults' : 'meetingsUi.emptyResolutions')" :caption="t('nav.meetingFollowup')" @retry="query.refetch()">
        <template #record_number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
        <template #name-cell="{ row }"><NuxtLink :to="meetingTo(row.original)" class="block break-words text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.name }}</NuxtLink><p class="mt-0.5 break-words text-xs text-muted">{{ row.original.meeting_name }}</p></template>
        <template #responsible-cell="{ row }">
          <div v-if="row.original.responsible" class="flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[row.original.responsible]" /><span class="min-w-0 truncate text-muted">{{ row.original.responsible.name }}</span></div>
          <span v-else class="text-muted">—</span>
        </template>
        <template #deadline-cell="{ row }"><span v-if="row.original.deadline" class="whitespace-nowrap">{{ formatMeetingDate(row.original.deadline, locale) }}</span><span v-else>{{ row.original.execution_period || '—' }}</span></template>
        <template #execution_state-cell="{ row }"><SharedStatusBadge v-bind="resolutionStateBadgeProps(row.original.execution_state ?? row.original.state, t)" /></template>
        <template #task-cell="{ row }"><UButton v-if="row.original.task_id" :to="`/tasks/${row.original.task_id}`" target="_blank" rel="noopener" color="neutral" variant="link" icon="i-lucide-external-link" :label="t('meetingsUx.openTaskNewTab')" /></template>
        <template #mobile-row="{ row }"><div class="grid min-w-0 gap-2"><NuxtLink :to="meetingTo(row)" class="break-words font-semibold text-highlighted">{{ row.name }}</NuxtLink><p class="break-words text-xs text-muted">{{ row.meeting_name }}</p><div class="flex flex-wrap items-center gap-2 text-sm"><SharedStatusBadge v-bind="resolutionStateBadgeProps(row.execution_state ?? row.state, t)" /><span>{{ row.responsible?.name || '—' }}</span><span>{{ row.deadline ? formatMeetingDate(row.deadline, locale) : row.execution_period || '—' }}</span></div><UButton v-if="row.task_id" :to="`/tasks/${row.task_id}`" target="_blank" rel="noopener" variant="link" :label="t('meetingsUx.openTaskNewTab')" /></div></template>
      </SharedDataTable>
      <template v-if="!query.error.value && rows.length" #footer>
        <SharedListFooter :count-label="t('meetingsUi.footer.results', { shown: rows.length, total }, total)" count-test-id="meeting-followup-result-count" :page="page" :pages="pages" :disabled="query.isFetching.value || !hydrated" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
