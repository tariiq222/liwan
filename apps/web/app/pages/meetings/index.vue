<script setup lang="ts">
import { Plus, Search, X } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { meetingCreateRoute } from '@/utils/meetingRoutes'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const search = ref(String(route.query.q ?? ''))
const state = ref(String(route.query.state ?? ''))
const mine = ref(route.query.mine === '1')
const debouncedSearch = refDebounced(search, 250)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const query = useMeetings(computed(() => ({
  q: debouncedSearch.value.trim() || undefined,
  state: state.value || undefined,
  mine: mine.value || undefined,
  project_id: route.query.project_id ? Number(route.query.project_id) : undefined,
  series_id: route.query.series_id ? Number(route.query.series_id) : undefined,
  limit,
  offset: offset.value,
})))
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const hasActiveFilters = computed(() => Boolean(search.value.trim() || state.value || mine.value || route.query.project_id || route.query.series_id))
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
const createMeetingTo = computed(() => meetingCreateRoute(route.fullPath, projectId.value))

watch(() => [route.query.q, route.query.offset, route.query.state, route.query.mine], ([q, nextOffset, nextState, nextMine]) => {
  search.value = String(q ?? '')
  state.value = String(nextState ?? '')
  mine.value = nextMine === '1'
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => {
  const next = value.trim()
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (next === current) return
  offset.value = 0
  void router.replace({ query: { ...route.query, q: next || undefined, offset: undefined } })
})
function applyFilters() {
  offset.value = 0
  void router.replace({
    query: {
      ...route.query,
      state: state.value || undefined,
      mine: mine.value ? '1' : undefined,
      offset: undefined,
    },
  })
}

function clearFilters() {
  search.value = ''
  state.value = ''
  mine.value = false
  void router.replace({ query: {} })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: offset.value || undefined } })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetings')">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="createMeetingTo">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.new') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <div class="relative min-w-52">
            <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              v-model="search"
              :disabled="!hydrated"
              :placeholder="t('meetingsUi.search')"
              :aria-label="t('meetingsUi.search')"
              class="ps-8"
            />
          </div>
        </template>
        <select v-model="state" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @change="applyFilters">
          <option value="">{{ t('meetingsUi.allStates') }}</option>
          <option v-for="code in ['draft', 'confirmed', 'done', 'cancelled']" :key="code" :value="code">{{ t(`meetingsUi.state.${code}`) }}</option>
        </select>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="mine" type="checkbox" :disabled="!hydrated" @change="applyFilters">
          {{ t('meetingsUi.mine') }}
        </label>
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <Badge v-if="search.trim()" variant="secondary">{{ t('meetingsUi.searchValue', { value: search }) }}</Badge>
            <Button variant="ghost" size="sm" class="gap-1" :disabled="!hydrated" @click="clearFilters">
              <X class="size-3.5" />{{ t('meetingsUi.clear') }}
            </Button>
          </div>
        </template>
      </FilterBar>
    </div>
    <SharedPageState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="!query.isLoading.value && !(query.data.value?.items.length)"
      :empty-text="t('meetingsUi.empty')"
      @retry="query.refetch"
    >
      <div class="nasq-panel overflow-hidden">
        <Table class="min-w-[720px]" :aria-label="t('nav.meetings')">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{{ t('meetingsUi.title') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.date') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.organizer') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.stateLabel') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.resolutions') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="meeting in query.data.value?.items" :key="meeting.id">
              <TableCell class="min-w-56 whitespace-normal">
                <NuxtLink
                  :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                  class="block rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {{ meeting.name }}
                </NuxtLink>
                <span class="mt-1 block text-xs text-muted-foreground">{{ meeting.reference }}</span>
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale) : '—' }}
              </TableCell>
              <TableCell class="whitespace-normal">{{ meeting.organizer?.name || '—' }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ t('meetingsUi.openCount', { count: meeting.open_resolution_count }) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </SharedPageState>
    <nav v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="setPage(page - 1)">
        {{ t('projects.previousPage') }}
      </Button>
      <span>{{ t('meetingsUi.pageOf', { page, pages }) }}</span>
      <Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="setPage(page + 1)">
        {{ t('projects.nextPage') }}
      </Button>
    </nav>
  </SharedPageContainer>
</template>
