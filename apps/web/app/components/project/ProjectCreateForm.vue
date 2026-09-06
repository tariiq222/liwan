<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useCreateProject } from '@/composables/useProjects'

const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useCreateProject()

const name = ref('')
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!trimmed) return
  try {
    const created = await mutateAsync({ name: trimmed })
    emit('created', created.id)
  } catch (e) {
    error.value = e instanceof ApiError && e.code === 'create_forbidden' ? t('projects.createForbidden') : e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form data-testid="project-create-form" class="nasq-form-grid" @submit.prevent="submit">
    <div class="grid gap-2 sm:col-span-2">
      <Label for="new-project-name">{{ t('projects.newName') }}</Label>
      <Input id="new-project-name" v-model="name" data-testid="project-create-name" required :disabled="!hydrated || isPending" />
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive sm:col-span-2">{{ error }}</p>
    <div class="nasq-form-footer sm:col-span-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
    </div>
  </form>
</template>
