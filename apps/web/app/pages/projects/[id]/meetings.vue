<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@nasq/contracts'
import { inject } from 'vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useMeetings } from '@/composables/useMeetings'
import { useProject } from '@/composables/useProjects'
import { meetingStateColor } from '@/utils/meetingStatus'
import { parsePositiveId } from '@/utils/routeParams'
import { parseOffset } from '@/utils/routeQuery'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
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
function openCreate() {
  if (!projectId.value || !canCreate.value || !hydrated.value) return
  router.push({
    path: '/meetings/new',
    query: { project_id: String(projectId.value), project_name: project.value?.name, ...returnToQuery(route.fullPath) },
  })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  const nextOffset = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: nextOffset ? String(nextOffset) : undefined } })
}
</script>

<template>
  <SharedPageContainer width="list" data-testid="project-meetings">
    <SharedPageHeader v-if="!isProjectOverlay" :title="t('projects.tabs.meetings')">
      <template #actions>
        <UButton v-if="canCreate" data-testid="project-meetings-create" icon="i-lucide-plus" :disabled="!hydrated" @click="openCreate">
          {{ t('meetingsUi.new') }}
        </UButton>
      </template>
    </SharedPageHeader>
    <SharedPageState
      :loading="!notFound && query.isLoading.value"
      :error="notFound ? null : query.error.value"
      :empty="notFound || (!query.isLoading.value && !items.length)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.meetings.empty')"
      @retry="query.refetch"
    >
      <div class="min-w-0 overflow-hidden rounded-lg bg-default ring ring-default">
        <ul class="grid divide-y divide-default md:hidden">
          <li v-for="meeting in items" :key="meeting.id">
            <NuxtLink
              :to="meetingTo(meeting)"
              class="grid min-w-0 gap-2 p-3 hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <div class="flex min-w-0 items-start justify-between gap-2">
                <span class="min-w-0 break-words font-medium text-primary">{{ meeting.name }}</span>
                <UBadge :color="meetingStateColor(meeting.state)" variant="subtle" class="shrink-0">{{ t(`meetingsUi.state.${meeting.state}`) }}</UBadge>
              </div>
              <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                <bdi>{{ dateLabel(meeting.meeting_date) }}</bdi>
                <span v-if="meeting.organizer">{{ meeting.organizer.name }}</span>
              </div>
            </NuxtLink>
          </li>
        </ul>
        <div class="hidden overflow-x-auto md:block">
          <UTable :data="items" :columns="columns" :caption="t('projects.tabs.meetings')" :ui="{ caption: 'sr-only' }">
            <template #id-cell="{ row }"><RecordNumber :value="row.original.reference.trim() || row.original.id" /></template>
            <template #name-cell="{ row }">
              <UButton color="primary" variant="link" class="p-0 font-medium whitespace-normal text-start" :to="meetingTo(row.original)">{{ row.original.name }}</UButton>
            </template>
            <template #meeting_date-cell="{ row }"><bdi>{{ dateLabel(row.original.meeting_date) }}</bdi></template>
            <template #organizer-cell="{ row }">{{ row.original.organizer?.name || '—' }}</template>
            <template #state-cell="{ row }"><UBadge :color="meetingStateColor(row.original.state)" variant="subtle">{{ t(`meetingsUi.state.${row.original.state}`) }}</UBadge></template>
            <template #open_resolution_count-cell="{ row }">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }) }}</template>
          </UTable>
        </div>
      </div>
    </SharedPageState>
    <SharedPagination v-if="pages > 1" :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
  </SharedPageContainer>
</template>
