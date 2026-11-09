<script setup lang="ts">
import type { ProjectDetail } from '@liwan/contracts'
import { useProjectArchive } from '@/composables/useProjectArchive'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { archive: archiveProject, restore, pending } = useProjectArchive(() => props.project)
const confirming = ref(false)

async function archive() {
  if (await archiveProject()) confirming.value = false
}
</script>

<template>
  <div v-if="project.can_manage" class="grid gap-(--liwan-gap-card)" data-testid="project-archive-settings">
    <SharedInlineConfirm
      v-if="project.active && confirming"
      data-testid="project-archive-confirm"
      :title="t('projects.archiveConfirmTitle')"
      :description="t('projects.archiveConfirmText')"
      :confirm-label="t('projects.menu.archive')"
      :pending="pending"
      @cancel="confirming = false"
      @confirm="archive"
    />

    <UButton
      v-else
      type="button"
      :color="project.active ? 'error' : 'neutral'"
      variant="outline"
      :icon="project.active ? 'i-lucide-archive' : 'i-lucide-archive-restore'"
      data-testid="project-settings-archive"
      :disabled="!hydrated || pending"
      :label="t(project.active ? 'projects.menu.archive' : 'projects.menu.unarchive')"
      @click="project.active ? (confirming = true) : restore()"
    />
  </div>
</template>
