<script setup lang="ts">
import type { Project, ProjectDetail } from '@nasq/contracts'
import { MoreHorizontal } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = withDefaults(defineProps<{ project: Project | ProjectDetail; hideSettings?: boolean }>(), { hideSettings: false })
const emit = defineEmits<{ settings: []; archived: []; unarchived: [] }>()

const { t } = useI18n()
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
  <DropdownMenu v-if="project.can_manage">
    <DropdownMenuTrigger as-child :disabled="!hydrated">
      <button
        type="button"
        data-testid="project-menu"
        class="inline-flex size-[32px] items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        :disabled="!hydrated"
        :aria-label="t('projects.menu.label')"
        @click.stop
      >
        <MoreHorizontal class="size-[18px]" />
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

  <div v-if="project.active && confirmOpen" data-testid="project-archive-confirm" class="mt-2 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
    <p class="font-medium">{{ t('projects.archiveConfirmTitle') }}</p>
    <p class="text-muted-foreground">{{ t('projects.archiveConfirmText') }}</p>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" :disabled="archiving" @click.stop="confirmOpen = false">{{ t('app.cancel') }}</Button>
      <Button variant="destructive" size="sm" :disabled="archiving" @click.stop="doArchive">{{ t('projects.menu.archive') }}</Button>
    </div>
  </div>
</template>
