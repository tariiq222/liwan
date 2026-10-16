<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { z } from 'zod'
import type { MeetingPreviousResolutionSchema } from '@webvue/contracts'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { refDebounced } from '@vueuse/core'
import { useMeetingFollowup, type MeetingFollowupParams } from '@/composables/useMeetingWorkspace'
import { formatMeetingDate } from '@/utils/meetingMinutesForm'
import { resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { parseOffset, firstQuery } from '@/utils/routeQuery'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

type Row = z.infer<typeof MeetingPreviousResolutionSchema>
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
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
const rows = computed(() => query.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const page = computed(() => Math.floor(filters.value.offset / limit) + 1)
const stateOptions = computed(() => states.map(value => ({ value, label: value === 'all' ? t('meetingsUi.allStates') : value === 'active' || value === 'overdue' ? t(value === 'active' ? 'meetingTimeline.activeFollowup' : 'meetingTimeline.overdueFollowup') : t(`meetingsUi.resolutionState.${value}`) })))
const columns = computed<TableColumn<Row>[]>(() => [
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
  <SharedListPage :title="t('nav.meetingFollowup')" :description="t('meetingsUx.followupDescription')">
    <template #filters>
      <FilterBar :active-count="[search.trim(), filters.mine, filters.state !== 'active'].filter(Boolean).length" :disabled="!hydrated" @clear="search = ''; patch({ q: undefined, mine: undefined, state: undefined })">
        <template #search><UInput id="followup-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsUx.followupSearch')" :aria-label="t('meetingsUx.followupSearch')" /></template>
        <SharedFilterChoice :label="t('meetingsUi.stateLabel')" :model-value="filters.state" :items="stateOptions" :disabled="!hydrated" @update:model-value="patch({ state: String($event) })" />
        <SharedFilterChoice :label="t('meetingsUi.responsible')" :model-value="filters.mine ? 'mine' : 'all'" :items="[{ value: 'all', label: t('meetingsUx.followupAll') }, { value: 'mine', label: t('meetingsUx.followupMine') }]" :disabled="!hydrated" @update:model-value="patch({ mine: $event === 'mine' ? '1' : undefined })" />
      </FilterBar>
    </template>
    <SharedDataTable :rows="rows" :columns="columns" row-key="id" :row-to="meetingTo" :loading="query.isLoading.value" :error="query.error.value" :empty-text="t('meetingsUi.emptyResolutions')" :caption="t('nav.meetingFollowup')" :page="page" :pages="pages" @update:page="setPage" @retry="query.refetch()">
      <template #name-cell="{ row }"><NuxtLink :to="meetingTo(row.original)" class="block break-words font-medium text-primary hover:underline">{{ row.original.name }}</NuxtLink><p class="mt-1 break-words text-xs text-muted">{{ row.original.meeting_name }}</p></template>
      <template #responsible-cell="{ row }">{{ row.original.responsible?.name || '—' }}</template>
      <template #deadline-cell="{ row }"><span v-if="row.original.deadline" class="whitespace-nowrap">{{ formatMeetingDate(row.original.deadline, locale) }}</span><span v-else>{{ row.original.execution_period || '—' }}</span></template>
      <template #execution_state-cell="{ row }"><SharedStatusBadge v-bind="resolutionStateBadgeProps(row.original.execution_state ?? row.original.state, t)" /></template>
      <template #task-cell="{ row }"><UButton v-if="row.original.task_id" :to="`/tasks/${row.original.task_id}`" target="_blank" rel="noopener" color="neutral" variant="link" icon="i-lucide-external-link" :label="t('meetingsUx.openTaskNewTab')" /></template>
      <template #mobile-row="{ row }"><div class="grid min-w-0 gap-2"><NuxtLink :to="meetingTo(row)" class="break-words font-medium text-primary">{{ row.name }}</NuxtLink><p class="break-words text-xs text-muted">{{ row.meeting_name }}</p><div class="flex flex-wrap items-center gap-2 text-sm"><SharedStatusBadge v-bind="resolutionStateBadgeProps(row.execution_state ?? row.state, t)" /><span>{{ row.responsible?.name || '—' }}</span><span>{{ row.deadline ? formatMeetingDate(row.deadline, locale) : row.execution_period || '—' }}</span></div><UButton v-if="row.task_id" :to="`/tasks/${row.task_id}`" target="_blank" rel="noopener" variant="link" :label="t('meetingsUx.openTaskNewTab')" /></div></template>
    </SharedDataTable>
  </SharedListPage>
</template>
