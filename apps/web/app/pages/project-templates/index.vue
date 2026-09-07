<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Plus, Search } from '@lucide/vue'
import { useProjectTemplateList } from '@/composables/useProjectTemplates'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
usePageHeader(() => t('projects.templates.title'), () => t('projects.templates.description'))
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
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('projects.templates.title')" :description="t('projects.templates.description')">
      <template #actions><Button v-if="canManage" :disabled="!hydrated" @click="router.push(detailPath())"><Plus class="me-2 size-4" />{{ t('projects.templates.actions.new') }}</Button></template>
    </SharedPageHeader>
    <div class="nasq-toolbar"><div class="relative min-w-52 flex-1"><Search class="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input v-model="search" name="template-search" :aria-label="t('projects.templates.filters.search')" class="ps-8" :disabled="!hydrated" :placeholder="t('projects.templates.filters.search')" /></div></div>
    <p v-if="list.isPending.value" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    <p v-else-if="list.error.value" role="alert" class="text-destructive">{{ t('projects.loadError') }}</p>
    <div v-else-if="!items.length" class="nasq-empty-state"><p>{{ t('projects.templates.empty') }}</p><Button v-if="canManage" :disabled="!hydrated" @click="router.push(detailPath())">{{ t('projects.templates.actions.new') }}</Button></div>
    <div v-else class="grid gap-3 md:grid-cols-2">
      <NuxtLink v-for="item in items" :key="item.id" :to="detailPath(item.id)" class="rounded-lg border bg-card p-4 text-start transition hover:border-primary">
        <div class="flex items-start justify-between gap-3"><div><h2 class="font-medium">{{ item.name }}</h2><p class="mt-1 text-sm text-muted-foreground">{{ item.description }}</p></div><span v-if="item.can_apply && canApply" class="text-xs text-muted-foreground">{{ t('projects.templates.canApply') }}</span></div>
        <p class="mt-3 text-xs text-muted-foreground">{{ t('projects.templates.summary', { stages: item.definition.stages.length, tasks: item.definition.tasks.length, milestones: item.definition.milestones.length }) }}</p>
      </NuxtLink>
    </div>
    <nav v-if="!list.isPending.value && !list.error.value && (total > pageSize || offset > 0)" class="flex flex-wrap items-center justify-between gap-3" :aria-label="t('projects.templates.pagination.label')">
      <p role="status" class="text-sm text-muted-foreground">{{ t('projects.templates.pagination.count', { from: items.length ? offset + 1 : 0, to: offset + items.length, total }) }}</p>
      <div class="flex gap-2"><Button variant="outline" :disabled="!hydrated || list.isFetching.value || offset === 0" @click="goPage(Math.max(0, offset - pageSize))">{{ t('projects.templates.pagination.previous') }}</Button><Button variant="outline" :disabled="!hydrated || list.isFetching.value || offset + pageSize >= total" @click="goPage(offset + pageSize)">{{ t('projects.templates.pagination.next') }}</Button></div>
    </nav>
  </SharedPageContainer>
</template>
