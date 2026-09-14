<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import { useProjectTemplateList } from '@/composables/useProjectTemplates'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const q = refDebounced(search, 250)
const pageSize = 50
const offset = computed(() => {
  const value = Number(route.query.offset)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
})
watch(q, value => { if (value.trim() !== (route.query.q ?? '')) router.replace({ query: value.trim() ? { q: value.trim() } : {} }) })
watch(() => route.query.q, value => { search.value = typeof value === 'string' ? value : '' })
const list = useProjectTemplateList(computed(() => ({ q: typeof route.query.q === 'string' ? route.query.q : '', limit: pageSize, offset: offset.value })))
const total = computed(() => list.data.value?.total ?? 0)
const detailPath = (id?: number) => ({ path: id ? `/project-templates/${id}` : '/project-templates/new', query: { returnTo: route.fullPath } })
function goPage(next: number) { router.push({ query: { ...route.query, offset: next || undefined } }) }
const items = computed(() => list.data.value?.items ?? [])
const canManage = computed(() => list.data.value?.can_manage ?? false)
const canApply = computed(() => list.data.value?.can_apply ?? false)
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())))
function clearFilters() {
  search.value = ''
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('projects.templates.title')" :description="t('projects.templates.description')">
      <template #actions><UButton v-if="canManage" icon="i-lucide-plus" :disabled="!hydrated" @click="router.push(detailPath())">{{ t('projects.templates.actions.new') }}</UButton></template>
    </SharedPageHeader>
    <div class="w-full min-w-0">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" name="template-search" :aria-label="t('projects.templates.filters.search')" icon="i-lucide-search" :disabled="!hydrated" :placeholder="t('projects.templates.filters.search')" class="w-full min-w-52" />
        </template>
        <template #active>
          <div v-if="search.trim()" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip :label="`${t('projects.templates.filters.search')}: ${search}`" @remove="clearFilters" />
          </div>
        </template>
      </FilterBar>
    </div>
    <SharedPageState :loading="list.isLoading.value" :error="list.error.value" :empty="!list.isLoading.value && !list.error.value && !items.length" :empty-text="t('projects.templates.empty')" @retry="list.refetch">
      <div class="grid gap-3 md:grid-cols-2">
        <NuxtLink v-for="item in items" :key="item.id" :to="detailPath(item.id)" class="nasq-ui-record-surface p-4 text-start transition-colors hover:bg-elevated/30">
          <div class="flex items-start justify-between gap-3"><div><h2 class="font-medium">{{ item.name }}</h2><p class="mt-1 text-sm text-muted">{{ item.description }}</p></div><span v-if="item.can_apply && canApply" class="text-xs text-muted">{{ t('projects.templates.canApply') }}</span></div>
          <p class="mt-3 text-xs text-muted">{{ t('projects.templates.summary', { stages: item.definition.stages.length, tasks: item.definition.tasks.length, milestones: item.definition.milestones.length }) }}</p>
        </NuxtLink>
      </div>
    </SharedPageState>
    <nav v-if="!list.isLoading.value && !list.error.value && (total > pageSize || offset > 0)" class="flex flex-wrap items-center justify-between gap-3" :aria-label="t('projects.templates.pagination.label')">
      <p role="status" class="text-sm text-muted">{{ t('projects.templates.pagination.count', { from: items.length ? offset + 1 : 0, to: offset + items.length, total }) }}</p>
      <div class="flex gap-2"><UButton color="neutral" variant="outline" :disabled="!hydrated || list.isFetching.value || offset === 0" @click="goPage(Math.max(0, offset - pageSize))">{{ t('projects.templates.pagination.previous') }}</UButton><UButton color="neutral" variant="outline" :disabled="!hydrated || list.isFetching.value || offset + pageSize >= total" @click="goPage(offset + pageSize)">{{ t('projects.templates.pagination.next') }}</UButton></div>
    </nav>
  </SharedPageContainer>
</template>
