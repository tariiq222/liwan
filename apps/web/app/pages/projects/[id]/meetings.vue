<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@nasq/contracts'
import RecordNumber from '@nasq/ui/app/components/shared/data/RecordNumber.vue'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { useMeetings } from '@/composables/useMeetings'
import { useProject } from '@/composables/useProjects'
import { meetingStateBadgeProps } from '@/utils/meetingStatus'
import { parsePositiveId } from '@/utils/routeParams'
import { parseOffset } from '@/utils/routeQuery'
import { returnToQuery } from '@nasq/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const projectId = computed(() => parsePositiveId(route.params.id))
const { data: project, error: projectError } = useProject(projectId)

const limit = 25
const offset = computed(() => parseOffset(route.query.offset))
// Without a valid project id the request would drop its only filter and list every meeting.
const query = useMeetings(
  computed(() => ({ project_id: projectId.value ?? undefined, limit, offset: offset.value })),
  { enabled: () => projectId.value !== null },
)
const items = computed(() => query.data.value?.items ?? [])
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const notFound = computed(() => projectId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
const canCreate = computed(() => can('meetings.create') && project.value?.active === true)

const columns = computed<TableColumn<MeetingListItem>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('meetingsUi.title') },
  { accessorKey: 'meeting_date', header: t('meetingsUi.date') },
  { accessorKey: 'organizer', header: t('meetingsUi.organizer') },
  { accessorKey: 'state', header: t('meetingsUi.stateLabel') },
  { accessorKey: 'open_resolution_count', header: t('meetingsUi.resolutions') },
])

function meetingTo(meeting: MeetingListItem) {
  return { path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }
}
function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
const createTo = computed(() => canCreate.value && projectId.value ? { path: '/meetings/new', query: { project_id: String(projectId.value), project_name: project.value?.name, ...returnToQuery(route.fullPath) } } : undefined)
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  const nextOffset = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: nextOffset ? String(nextOffset) : undefined } })
}
</script>

<template>
  <SharedListPage
    data-testid="project-meetings"
    hide-header
    :title="t('projects.tabs.meetings')"
    :create-to="createTo"
    :create-label="t('meetingsUi.new')"
    create-test-id="project-meetings-create"
  >
    <SharedDataTable
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="meetingTo"
      :loading="!notFound && query.isLoading.value"
      :error="notFound ? null : query.error.value"
      :empty-text="notFound ? t('projects.notFound') : t('projects.meetings.empty')"
      :page="page"
      :pages="pages"
      :caption="t('projects.tabs.meetings')"
      @update:page="setPage"
      @retry="query.refetch"
    >
      <template #id-cell="{ row }"><RecordNumber :value="row.original.reference.trim() || row.original.id" /></template>
      <template #name-cell="{ row }">
        <NuxtLink :to="meetingTo(row.original)" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</NuxtLink>
      </template>
      <template #meeting_date-cell="{ row }"><bdi>{{ dateLabel(row.original.meeting_date) }}</bdi></template>
      <template #organizer-cell="{ row }">{{ row.original.organizer?.name || '—' }}</template>
      <template #state-cell="{ row }"><SharedStatusBadge v-bind="meetingStateBadgeProps(row.original.state, t)" /></template>
      <template #open_resolution_count-cell="{ row }">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }, row.original.open_resolution_count) }}</template>
      <template #mobile-row="{ row: meeting }">
        <div class="grid min-w-0 gap-2">
          <div class="flex min-w-0 items-start justify-between gap-2">
            <NuxtLink :to="meetingTo(meeting)" class="min-w-0 break-words font-medium text-highlighted hover:underline">{{ meeting.name }}</NuxtLink>
            <SharedStatusBadge v-bind="meetingStateBadgeProps(meeting.state, t)" class="shrink-0" />
          </div>
          <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <bdi>{{ dateLabel(meeting.meeting_date) }}</bdi>
            <span v-if="meeting.organizer">{{ meeting.organizer.name }}</span>
          </div>
        </div>
      </template>
    </SharedDataTable>
  </SharedListPage>
</template>
