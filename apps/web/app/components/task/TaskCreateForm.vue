<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjects } from '@/composables/useProjects'
import { useCreateTask } from '@/composables/useTasks'
import { isDirtySnapshot } from '@/lib/formDirty'

const props = defineProps<{ projectId?: number }>()
const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { data: projects } = useProjects()
const { mutateAsync, isPending } = useCreateTask()

const name = ref('')
const selectedProjectId = ref<number | undefined>(props.projectId)
const error = ref<string | null>(null)
const submitted = ref(false)
const baseline = ref(JSON.stringify(['', props.projectId]))

function state() {
  return JSON.stringify([name.value, selectedProjectId.value])
}

const dirty = computed(() => isDirtySnapshot(baseline.value, state(), submitted.value))

watch(
  () => [props.projectId, projects.value] as const,
  () => {
    if (props.projectId) selectedProjectId.value = props.projectId
    else if (!selectedProjectId.value) selectedProjectId.value = projects.value?.[0]?.id
    if (!name.value && !submitted.value) baseline.value = state()
  },
  { immediate: true },
)

const lockedProjectName = computed(() => projects.value?.find((p) => p.id === props.projectId)?.name ?? '')

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!hydrated.value || isPending.value || !trimmed || !selectedProjectId.value) return
  try {
    const created = await mutateAsync({ name: trimmed, project_id: selectedProjectId.value })
    submitted.value = true
    emit('created', created.id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form data-testid="task-create-form" class="nasq-form-grid" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="new-task-name">{{ t('tasks.newTitle') }}</Label>
      <Input id="new-task-name" v-model="name" required :disabled="!hydrated || isPending" />
    </div>
    <div class="grid gap-2">
      <Label for="new-task-project">{{ t('tasks.project') }}</Label>
      <p v-if="props.projectId" id="new-task-project" class="text-sm">{{ lockedProjectName }}</p>
      <Select v-else :model-value="selectedProjectId ? String(selectedProjectId) : undefined" :disabled="!hydrated || isPending" @update:model-value="(v) => (selectedProjectId = v ? Number(v) : undefined)">
        <SelectTrigger id="new-task-project" class="w-full">
          <SelectValue :placeholder="t('tasks.project')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="p in projects ?? []" :key="p.id" :value="String(p.id)">{{ p.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <p v-if="error" role="alert" class="sm:col-span-2 text-sm text-destructive">{{ error }}</p>
    <div class="nasq-form-footer justify-end sm:col-span-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !name.trim() || !selectedProjectId">{{ t('app.create') }}</Button>
    </div>
  </form>
</template>
