<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import type { ProjectDetail } from '@nasq/contracts'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'

defineProps<{ project: ProjectDetail }>()
// ONE primary action stays in the header (create task) — settings/archive
// move into ProjectMenu, matching the project table row's menu.
const emit = defineEmits<{ create: []; settings: []; archived: []; unarchived: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <header class="flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-semibold">{{ project.name }}</h1>
    <ProjectStatusSelect v-if="project.can_manage" :project="project" />
    <ProjectStatusBadge v-else :status="project.status" />
    <ProjectProgress :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" />
    <div class="ms-auto flex items-center gap-1">
      <Button size="sm" class="gap-1.5" :disabled="!hydrated" @click="emit('create')">
        <Plus class="size-4" />{{ t('tasks.new') }}
      </Button>
      <ProjectMenu :project="project" @settings="emit('settings')" @archived="emit('archived')" @unarchived="emit('unarchived')" />
    </div>
  </header>
</template>
