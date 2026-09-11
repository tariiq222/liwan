<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useArchiveProject, useUnarchiveProject } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: archiveProject, isPending: archiving } = useArchiveProject()
const { mutateAsync: restoreProject, isPending: restoring } = useUnarchiveProject()
const confirming = ref(false)
const pending = computed(() => archiving.value || restoring.value)

async function archive() {
  if (!props.project.can_manage || !hydrated.value || pending.value) return
  try {
    await archiveProject({ id: props.project.id })
    confirming.value = false
    toast.add({ title: t('projects.archived'), color: 'success' })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}

async function restore() {
  if (!props.project.can_manage || !hydrated.value || pending.value) return
  try {
    await restoreProject({ id: props.project.id })
    toast.add({ title: t('projects.unarchived'), color: 'success' })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <div v-if="project.can_manage" class="space-y-3" data-testid="project-archive-settings">
    <div v-if="project.active && confirming" class="rounded-lg border border-error/30 bg-error/5 space-y-2 p-3 text-sm" data-testid="project-archive-confirm">
      <p class="font-medium">{{ t('projects.archiveConfirmTitle') }}</p>
      <p class="text-muted">{{ t('projects.archiveConfirmText') }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton type="button" color="secondary" size="sm" :disabled="pending" :label="t('app.cancel')" @click="confirming = false" variant="solid" />
        <UButton type="button" color="error" size="sm" :disabled="!hydrated || pending" :label="t('projects.menu.archive')" @click="archive" />
      </div>
    </div>

    <UButton
      v-else
      type="button"
      :color="project.active ? 'secondary' : 'primary'"
      :icon="project.active ? 'i-lucide-archive' : 'i-lucide-archive-restore'"
      data-testid="project-settings-archive"
      :disabled="!hydrated || pending"
      :label="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
      @click="project.active ? (confirming = true) : restore()"
    />
  </div>
</template>
