<script setup lang="ts">
import { toast } from 'vue-sonner'
import CreateProjectDialog from '@/components/project/CreateProjectDialog.vue'
import ProjectTable from '@/components/project/ProjectTable.vue'
import { useProjectList } from '@/composables/useProjects'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()

// Always fetch the active list — same query key as ProjectTable's own
// useProjectList(archived) call whenever archived is false, so this doesn't
// cause a second network request in the common case, and it's the only
// source of truth for can_list_archived (the server only sets that flag on
// the full, non-minimal response).
const activeList = useProjectList(ref(false))
const canListArchived = computed(() => activeList.data.value?.can_list_archived ?? false)

// Never resolve to true unless the server says this user may list archived
// projects — a manager-gated 403 must never reach useProjectList, or an
// employee following a stale/shared `?archived=1` link sees a silent empty
// table instead of the active list.
const archived = computed(() => canListArchived.value && route.query.archived === '1')

function onFilterChange(v: unknown) {
  router.replace({ query: { ...route.query, archived: v === 'archived' ? '1' : undefined } })
}

const createOpen = ref(false)
function onCreated(id: number) {
  toast.success(t('projects.created'))
  router.push(`/projects/${id}`)
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('projects.title') }}</h1>

    <Tabs v-if="canListArchived" :model-value="archived ? 'archived' : 'active'" @update:model-value="onFilterChange">
      <TabsList>
        <TabsTrigger value="active" :disabled="!hydrated">{{ t('projects.filters.active') }}</TabsTrigger>
        <TabsTrigger value="archived" :disabled="!hydrated">{{ t('projects.filters.archived') }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <ProjectTable :archived="archived" @open="(id) => router.push(`/projects/${id}`)" @create="createOpen = true" />
    <CreateProjectDialog v-model:open="createOpen" @created="onCreated" />
  </div>
</template>
