<script setup lang="ts">
import { toast } from 'vue-sonner'
import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { PROJECT_STATUS_LABEL_KEY, PROJECT_STATUS_UNSET_KEY } from '@/composables/projectStatus'
import { useSetProjectStatus } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useSetProjectStatus()

// Pending → confirmed: the Select shows the server's value, never a guessed one.
async function onChange(v: unknown) {
  const status = v as ProjectStatus
  if (!status || status === props.project.status) return
  try {
    await mutateAsync({ id: props.project.id, status })
    toast.success(t('projects.statusUpdated'))
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <Select :model-value="project.status ?? undefined" :disabled="!hydrated || isPending" @update:model-value="onChange">
    <SelectTrigger size="sm" class="w-44" data-testid="project-status-select" :aria-label="t('projects.setStatus')">
      <SelectValue :placeholder="t(PROJECT_STATUS_UNSET_KEY)" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="s in PROJECT_STATUSES" :key="s" :value="s">{{ t(PROJECT_STATUS_LABEL_KEY[s]) }}</SelectItem>
    </SelectContent>
  </Select>
</template>
