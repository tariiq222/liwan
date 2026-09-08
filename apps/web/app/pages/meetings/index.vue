<script setup lang="ts">
import { Plus, Search, X } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const query = useMeetings(computed(() => ({
  q: debouncedSearch.value.trim() || undefined,
  limit,
  offset: offset.value,
})))
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const hasActiveFilters = computed(() => Boolean(search.value.trim()))

watch(() => [route.query.q, route.query.offset], ([q, nextOffset]) => {
  search.value = String(q ?? '')
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => {
  const next = value.trim()
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (next === current) return
  offset.value = 0
  void router.replace({ query: next ? { q: next } : {} })
})

function clearFilters() {
  search.value = ''
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
        <NuxtLink v-if="can('meetings.create')" :to="{ path: '/meetings/new', query: returnToQuery(route.fullPath) }">
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
        <template #active>
          <div v-if="hasActiveFilters" class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{{ t('meetingsUi.searchValue', { value: search }) }}</Badge>
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
        <NuxtLink
          v-for="meeting in query.data.value?.items"
          :key="meeting.id"
          :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
          class="flex items-center gap-3 border-b border-border/80 p-3 last:border-0 transition-colors hover:bg-muted/70"
        >
          <span class="font-medium">{{ meeting.name }}</span>
          <span class="ms-2 text-sm text-muted-foreground">{{ meeting.reference }}</span>
          <span class="ms-auto text-sm text-muted-foreground">{{ meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale) : '—' }} · {{ t(`meetingsUi.state.${meeting.state}`) }}</span>
        </NuxtLink>
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
