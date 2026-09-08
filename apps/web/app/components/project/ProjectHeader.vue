<script setup lang="ts">
import { Archive, ArchiveRestore, Pencil, Plus, Settings } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ProjectDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = withDefaults(defineProps<{
  project: ProjectDetail
  backTo?: string
  backLabel?: string
  showCreate?: boolean
  showEdit?: boolean
  createLabel?: string
  title?: string
  description?: string
  eyebrow?: string
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
const { mutateAsync: archiveMutate, isPending: archiving } = useArchiveProject()
const { mutateAsync: unarchiveMutate, isPending: unarchiving } = useUnarchiveProject()
const confirmOpen = ref(false)

async function doArchive() {
  try {
    await archiveMutate({ id: props.project.id })
    toast.success(t('projects.archived'))
    confirmOpen.value = false
    emit('archived')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}

async function doUnarchive() {
  try {
    await unarchiveMutate({ id: props.project.id })
    toast.success(t('projects.unarchived'))
    emit('unarchived')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <SharedPageHeader
    :title="props.title ?? project.name"
    :description="props.description"
    :eyebrow="props.eyebrow"
    :back-to="props.backTo"
    :back-label="props.backLabel || t('projects.backToProjects')"
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
      <template v-if="project.can_manage">
        <Button
          variant="outline"
          class="gap-2"
          data-testid="project-header-settings"
          :disabled="!hydrated"
          :aria-label="t('projects.menu.settings')"
          :title="t('projects.menu.settings')"
          @click="emit('settings')"
        >
          <Settings class="size-[18px]" />{{ t('projects.menu.settings') }}
        </Button>
        <Button
          variant="outline"
          class="gap-2"
          data-testid="project-header-archive"
          :disabled="!hydrated || archiving || unarchiving"
          :aria-label="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
          :title="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
          @click="project.active ? (confirmOpen = true) : doUnarchive()"
        >
          <Archive v-if="project.active" class="size-[18px]" />
          <ArchiveRestore v-else class="size-[18px]" />
          {{ t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive') }}
        </Button>
      </template>
    </template>
  </SharedPageHeader>

  <div v-if="project.active && confirmOpen" data-testid="project-archive-confirm" class="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
    <p class="font-medium">{{ t('projects.archiveConfirmTitle') }}</p>
    <p class="text-muted-foreground">{{ t('projects.archiveConfirmText') }}</p>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" :disabled="archiving" @click.stop="confirmOpen = false">{{ t('app.cancel') }}</Button>
      <Button variant="destructive" size="sm" :disabled="archiving" @click.stop="doArchive">{{ t('projects.menu.archive') }}</Button>
    </div>
  </div>
</template>
