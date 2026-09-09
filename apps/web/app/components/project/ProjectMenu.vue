<script setup lang="ts">
import type { Project, ProjectDetail } from '@nasq/contracts'
import { MoreHorizontal } from '@lucide/vue'
import { AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
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

  <AlertDialogRoot :open="project.active && confirmOpen" @update:open="open => { if (!open) confirmOpen = false }">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-50 bg-black/30" />
      <AlertDialogContent
        data-testid="project-archive-confirm"
        class="fixed start-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[420px] -translate-y-1/2 rounded-lg border bg-card p-6 text-start text-card-foreground shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2"
      >
        <AlertDialogTitle class="text-base font-semibold">{{ t('projects.archiveConfirmTitle') }}</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 text-sm leading-6 text-muted-foreground">{{ t('projects.archiveConfirmText') }}</AlertDialogDescription>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <AlertDialogCancel as-child>
            <Button type="button" variant="outline" :disabled="archiving">{{ t('app.cancel') }}</Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive" :disabled="archiving" @click="doArchive">{{ t('projects.menu.archive') }}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
