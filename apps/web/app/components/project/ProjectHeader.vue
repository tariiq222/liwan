<script setup lang="ts">
import { Pencil, Plus } from '@lucide/vue'
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
  <SharedPageHeader
    :title="props.title ?? project.name"
  >
    <template #actions>
      <Button
        v-if="showCreate && project.active && (props.canCreate ?? can('pmo.tasks.create'))"
        variant="default"
        class="gap-2"
        data-testid="project-header-create"
        :disabled="!hydrated"
        :aria-label="props.createLabel || t('tasks.new')"
        :title="props.createLabel || t('tasks.new')"
        @click="emit('create')"
      >
        <Plus class="size-[18px]" />{{ props.createLabel || t('tasks.new') }}
      </Button>
      <Button
        v-if="showEdit && project.can_manage"
        variant="default"
        size="icon"
        class="size-[32px] rounded-lg"
        data-testid="project-header-edit"
        :disabled="!hydrated"
        :aria-label="t('app.edit')"
        :title="t('app.edit')"
        @click="emit('edit')"
      >
        <Pencil class="size-[18px]" />
      </Button>
    </template>
  </SharedPageHeader>
</template>
