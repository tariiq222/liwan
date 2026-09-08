<script setup lang="ts">
import { Archive, ArchiveRestore } from '@lucide/vue'
import type { ProjectDetail } from '@nasq/contracts'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: archiveProject, isPending: archiving } = useArchiveProject()
const { mutateAsync: restoreProject, isPending: restoring } = useUnarchiveProject()
const confirming = ref(false)
const pending = computed(() => archiving.value || restoring.value)

async function archive() {
  if (!props.project.can_manage || !hydrated.value || pending.value) return
  try {
    await archiveProject({ id: props.project.id })
    confirming.value = false
    toast.success(t('projects.archived'))
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}

async function restore() {
  if (!props.project.can_manage || !hydrated.value || pending.value) return
  try {
    await restoreProject({ id: props.project.id })
    toast.success(t('projects.unarchived'))
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <div v-if="project.can_manage" class="space-y-3" data-testid="project-archive-settings">
    <div v-if="project.active && confirming" class="nasq-status-callout-danger space-y-2 p-3 text-sm" data-testid="project-archive-confirm">
      <p class="font-medium">{{ t('projects.archiveConfirmTitle') }}</p>
      <p class="text-muted-foreground">{{ t('projects.archiveConfirmText') }}</p>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="pending" @click="confirming = false">{{ t('app.cancel') }}</Button>
        <Button type="button" variant="destructive" size="sm" :disabled="!hydrated || pending" @click="archive">{{ t('projects.menu.archive') }}</Button>
      </div>
    </div>

    <Button
      v-else
      type="button"
      :variant="project.active ? 'outline' : 'default'"
      class="gap-2"
      data-testid="project-settings-archive"
      :disabled="!hydrated || pending"
      @click="project.active ? (confirming = true) : restore()"
    >
      <Archive v-if="project.active" class="size-4" />
      <ArchiveRestore v-else class="size-4" />
      {{ t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive') }}
    </Button>
  </div>
</template>
