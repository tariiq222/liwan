<script setup lang="ts">
import { Archive, ArchiveRestore, Plus, Settings } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ProjectDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail; backTo?: string }>()
const emit = defineEmits<{ create: []; settings: []; archived: []; unarchived: [] }>()
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
    :title="project.name"
    :back-to="props.backTo ?? '/projects'"
    :back-label="t('projects.backToProjects')"
  >
    <template #actions>
      <Button
        v-if="can('pmo.tasks.create')"
        variant="default"
        size="icon"
        class="size-[32px] rounded-lg"
        data-testid="project-header-create"
        :disabled="!hydrated"
        :aria-label="t('tasks.new')"
        :title="t('tasks.new')"
        @click="emit('create')"
      >
        <Plus class="size-[18px]" />
      </Button>
      <template v-if="project.can_manage">
        <Button
          variant="outline"
          size="icon"
          class="size-[32px] rounded-lg"
          data-testid="project-header-settings"
          :disabled="!hydrated"
          :aria-label="t('projects.menu.settings')"
          :title="t('projects.menu.settings')"
          @click="emit('settings')"
        >
          <Settings class="size-[18px]" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="size-[32px] rounded-lg"
          data-testid="project-header-archive"
          :disabled="!hydrated || archiving || unarchiving"
          :aria-label="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
          :title="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
          @click="project.active ? (confirmOpen = true) : doUnarchive()"
        >
          <Archive v-if="project.active" class="size-[18px]" />
          <ArchiveRestore v-else class="size-[18px]" />
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
