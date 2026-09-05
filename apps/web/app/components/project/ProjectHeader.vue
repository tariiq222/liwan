<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import type { ProjectDetail } from '@nasq/contracts'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'
import PageHeader from '@/components/shared/PageHeader.vue'

const props = defineProps<{ project: ProjectDetail; backTo?: string }>()
// ONE primary action stays in the header (create task) — settings/archive
// move into ProjectMenu, matching the project table row's menu.
const emit = defineEmits<{ create: []; settings: []; archived: []; unarchived: [] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
</script>

<template>
  <PageHeader
    :title="project.name"
    :back-to="props.backTo ?? '/projects'"
    :back-label="t('projects.backToProjects')"
  >
    <template #actions>
      <ProjectStatusSelect v-if="project.can_manage" :project="project" />
      <ProjectStatusBadge v-else :status="project.status" />
      <ProjectProgress :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" />
      <Button v-if="can('pmo.tasks.create')" size="sm" class="gap-1.5" :disabled="!hydrated" @click="emit('create')">
        <Plus class="size-4" />{{ t('tasks.new') }}
      </Button>
      <ProjectMenu :project="project" @settings="emit('settings')" @archived="emit('archived')" @unarchived="emit('unarchived')" />
    </template>
  </PageHeader>
</template>
