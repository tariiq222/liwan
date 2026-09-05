<script setup lang="ts">
import type { Project, ProjectDetail } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = withDefaults(defineProps<{ project: Project | ProjectDetail; hideSettings?: boolean }>(), { hideSettings: false })
const emit = defineEmits<{ settings: []; archived: []; unarchived: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: archiveMutate, isPending: archiving } = useArchiveProject()
const { mutateAsync: unarchiveMutate, isPending: unarchiving } = useUnarchiveProject()

// No `ui/alert-dialog` component exists yet in this tree (another task is
// adding one) — a plain Dialog stands in for the archive confirm.
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
  <DropdownMenu v-if="project.can_manage">
    <DropdownMenuTrigger as-child :disabled="!hydrated">
      <button
        type="button"
        data-testid="project-menu"
        class="inline-flex items-center rounded px-1 text-sm leading-none text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        :disabled="!hydrated"
        @click.stop
      >
        ⋯
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem v-if="!hideSettings" @select="emit('settings')">
        {{ t('projects.menu.settings') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="project.active" @select="confirmOpen = true">
        {{ t('projects.menu.archive') }}
      </DropdownMenuItem>
      <DropdownMenuItem v-else :disabled="unarchiving" @select="doUnarchive">
        {{ t('projects.menu.unarchive') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <Dialog v-if="project.active" :open="confirmOpen" @update:open="(v) => (confirmOpen = v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('projects.archiveConfirmTitle') }}</DialogTitle>
        <DialogDescription>{{ t('projects.archiveConfirmText') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="archiving" @click="confirmOpen = false">{{ t('app.cancel') }}</Button>
        <Button variant="destructive" :disabled="archiving" @click="doArchive">{{ t('projects.menu.archive') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
