<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjects } from '@/composables/useProjects'
import { useCreateTask } from '@/composables/useTasks'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; created: [id: number] }>()

const { t } = useI18n()
const { data: projects } = useProjects()
const { mutateAsync, isPending } = useCreateTask()

const name = ref('')
const projectId = ref<number | undefined>(undefined)
const error = ref<string | null>(null)

// Re-seed the form every time the dialog opens rather than on mount, since
// the same instance stays alive (as a v-model'd child of tasks.vue) across
// multiple opens.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = ''
    projectId.value = projects.value?.[0]?.id
    error.value = null
  },
)

async function submit() {
  error.value = null
  if (!name.value.trim() || !projectId.value) return
  try {
    const created = await mutateAsync({ name: name.value.trim(), project_id: projectId.value })
    emit('update:open', false)
    emit('created', created.id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('tasks.new') }}</DialogTitle>
      </DialogHeader>
      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="new-task-name">{{ t('tasks.newTitle') }}</Label>
          <Input id="new-task-name" v-model="name" required />
        </div>
        <div class="grid gap-2">
          <Label for="new-task-project">{{ t('tasks.project') }}</Label>
          <Select :model-value="projectId ? String(projectId) : undefined" @update:model-value="(v) => (projectId = v ? Number(v) : undefined)">
            <SelectTrigger id="new-task-project" class="w-full">
              <SelectValue :placeholder="t('tasks.project')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in projects ?? []" :key="p.id" :value="String(p.id)">{{ p.name }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="isPending || !name.trim() || !projectId">{{ t('app.create') }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
