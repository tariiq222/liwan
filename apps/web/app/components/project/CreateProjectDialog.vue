<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useCreateProject } from '@/composables/useProjects'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; created: [id: number] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useCreateProject()

const name = ref('')
const error = ref<string | null>(null)

// Re-seed the form every time the dialog opens rather than on mount, since
// the same instance stays alive (as a v-model'd child of projects.vue)
// across multiple opens — same reasoning as CreateTaskDialog.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = ''
    error.value = null
  },
)

async function submit() {
  error.value = null
  if (!name.value.trim()) return
  try {
    const created = await mutateAsync({ name: name.value.trim() })
    emit('update:open', false)
    emit('created', created.id)
  } catch (e) {
    error.value = e instanceof ApiError && e.code === 'create_forbidden' ? t('projects.createForbidden') : e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('projects.new') }}</DialogTitle>
      </DialogHeader>
      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="new-project-name">{{ t('projects.newName') }}</Label>
          <Input id="new-project-name" v-model="name" data-testid="project-create-name" required :disabled="!hydrated || isPending" />
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
