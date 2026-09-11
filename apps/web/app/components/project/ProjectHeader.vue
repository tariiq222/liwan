<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'

const props = withDefaults(defineProps<{
  project: ProjectDetail
  showCreate?: boolean
  showEdit?: boolean
  createLabel?: string
  title?: string
  canCreate?: boolean
}>(), {
  showCreate: true,
  showEdit: false,
  createLabel: undefined,
})
const emit = defineEmits<{ create: []; edit: []; settings: []; archived: []; unarchived: [] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
</script>

<template>
  <div class="min-w-0">
  <SharedPageHeader
    :title="props.title ?? project.name"
  >
    <template #actions>
      <UButton
        v-if="showCreate && project.active && (props.canCreate ?? can('pmo.tasks.create'))"
        icon="i-lucide-plus"
        data-testid="project-header-create"
        :disabled="!hydrated"
        :aria-label="props.createLabel || t('tasks.new')"
        :title="props.createLabel || t('tasks.new')"
        :label="props.createLabel || t('tasks.new')"
        @click="emit('create')"
      />
      <UButton
        v-if="showEdit && project.can_manage"
        square
        icon="i-lucide-pencil"
        data-testid="project-header-edit"
        :disabled="!hydrated"
        :aria-label="t('app.edit')"
        :title="t('app.edit')"
        @click="emit('edit')"
      />
    </template>
  </SharedPageHeader>
  </div>
</template>
