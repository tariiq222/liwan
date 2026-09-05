<script setup lang="ts">
import { toast } from 'vue-sonner'
import CreateProjectDialog from '@/components/project/CreateProjectDialog.vue'
import ProjectTable from '@/components/project/ProjectTable.vue'
import { useProjectList } from '@/composables/useProjects'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()

const archived = computed(() => route.query.archived === '1')
// Same query key as ProjectTable's own useProjectList(archived) call, so this
// doesn't cause a second network request — only a second subscriber to the
// cached result — and gives the page the `can_manage` flags it needs for the
// filter-chip visibility rule below.
const { data } = useProjectList(archived)

// Filter chips are only useful to someone who can archive/unarchive a
// project: admins/vendors always can, and any other role that already sees a
// can_manage project (e.g. a project manager) can too.
const canFilter = computed(() => {
  const role = me.value?.role
  if (role === 'admin' || role === 'vendor') return true
  return (data.value?.items ?? []).some((p) => p.can_manage)
})

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

    <Tabs v-if="canFilter" :model-value="archived ? 'archived' : 'active'" @update:model-value="onFilterChange">
      <TabsList>
        <TabsTrigger value="active" :disabled="!hydrated">{{ t('projects.filters.active') }}</TabsTrigger>
        <TabsTrigger value="archived" :disabled="!hydrated">{{ t('projects.filters.archived') }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <ProjectTable :archived="archived" @open="(id) => router.push(`/projects/${id}`)" @create="createOpen = true" />
    <CreateProjectDialog v-model:open="createOpen" @created="onCreated" />
  </div>
</template>
