<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import { useMeetingSeriesList } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const search = ref(String(route.query.q ?? ''))
const debouncedSearch = refDebounced(search, 250)
const limit = 25
const offset = ref(Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => ({
  q: search.value.trim() || undefined,
  limit,
  offset: offset.value,
}))
const query = useMeetingSeriesList(params)
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))

watch(() => [route.query.q, route.query.offset], ([q, nextOffset]) => {
  search.value = String(q ?? '')
  offset.value = Math.max(0, Number(nextOffset ?? 0) || 0)
})
watch(debouncedSearch, (value) => {
  const next = value.trim()
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (next === current) return
  offset.value = 0
  void router.replace({ query: { ...route.query, q: next || undefined, offset: undefined } })
})
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: { ...route.query, offset: offset.value || undefined } })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetingSeries')">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="{ path: '/meetings/series/new', query: returnToQuery(route.fullPath) }">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.newSeries') }}
          </Button>
        </NuxtLink>
    </template>
    </SharedPageHeader>
    <div class="nasq-toolbar">
      <Input v-model="search" :disabled="!hydrated" :placeholder="t('meetingsUi.searchSeries')" :aria-label="t('meetingsUi.searchSeries')" />
      <span class="text-sm text-muted-foreground">{{ t('meetingsUi.totalSeries', { count: query.data.value?.total ?? 0 }) }}</span>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value?.items.length" :empty-text="t('meetingsUi.emptySeries')" @retry="query.refetch">
      <div class="nasq-panel overflow-hidden">
        <NuxtLink
          v-for="series in query.data.value?.items"
          :key="series.id"
          :to="{ path: `/meetings/series/${series.id}`, query: returnToQuery(route.fullPath) }"
          class="flex items-center gap-3 border-b border-border/80 p-3 last:border-0 hover:bg-muted/70"
        >
          <span class="font-medium">{{ series.name }}</span>
          <span class="ms-auto text-sm text-muted-foreground">
            {{ t(`meetingsUi.recurrence.${series.recurrence}`) }}
            · {{ t('meetingsUi.openCount', { count: series.open_resolution_count }) }}
          </span>
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
