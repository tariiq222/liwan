<script setup lang="ts">
import { PROJECT_STATUSES, type ProjectDetail, type ProjectStatus } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { PROJECT_STATUS_LABEL_KEY, PROJECT_STATUS_UNSET_KEY } from '@/composables/projectStatus'
import { useSetProjectStatus } from '@/composables/useProjects'

const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync, isPending } = useSetProjectStatus()

const options = computed(() => PROJECT_STATUSES.map(s => ({ value: s, label: t(PROJECT_STATUS_LABEL_KEY[s]) })))

// Pending → confirmed: the Select shows the server's value, never a guessed one.
async function onChange(value: ProjectStatus | undefined) {
  if (!value || value === props.project.status) return
  try {
    await mutateAsync({ id: props.project.id, status: value })
    toast.add({ title: t('projects.statusUpdated'), color: 'success' })
  } catch (e) {
    toast.add({ title: e instanceof ApiError ? e.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <USelect
    :model-value="project.status ?? undefined"
    :items="options"
    :placeholder="t(PROJECT_STATUS_UNSET_KEY)"
    :disabled="!hydrated || isPending"
    size="sm"
    class="w-44"
    data-testid="project-status-select"
    :aria-label="t('projects.setStatus')"
    @update:model-value="onChange"
  />
</template>
