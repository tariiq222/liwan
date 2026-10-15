<script setup lang="ts">
import { ProjectCopyInputSchema } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCopyProject, useProject } from '@/composables/useProjects'

const props = defineProps<{ sourceId: number }>()
const emit = defineEmits<{ created: [id: number]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const sourceId = computed(() => props.sourceId)
const { data: source, isLoading, error, refetch } = useProject(sourceId)
const mutation = useCopyProject()

const name = ref('')
const startDate = ref<string | null>(null)
const baseline = ref('')
const initialized = ref(false)
const saved = ref(false)
const attempted = ref(false)

const serialized = () => JSON.stringify({ name: name.value, start_date: startDate.value })
const dirty = computed(() => initialized.value && !saved.value && serialized() !== baseline.value)
const parsedFields = computed(() => ProjectCopyInputSchema.safeParse({ name: name.value, start_date: startDate.value }))
const fieldErrors = computed(() => {
  if (!attempted.value || parsedFields.value.success) return {}
  const issues = parsedFields.value.error.issues
  return {
    name: issues.some(issue => issue.path[0] === 'name') ? t('projects.copy.validation.name') : undefined,
    start_date: issues.some(issue => issue.path[0] === 'start_date') ? t('projects.copy.validation.startDate') : undefined,
  }
})
const forbidden = computed(() => error.value instanceof ApiError && (error.value.status === 403 || error.value.status === 404))
const submitError = computed(() => {
  const failure = mutation.error.value
  if (!failure) return null
  if (failure instanceof ApiError && failure.status === 403) {
    // $api already turns a structured quota denial into the plan-limit message.
    return failure.code === 'feature_not_included' && failure.message ? failure.message : t('projects.copy.forbidden')
  }
  if (failure instanceof ApiError && failure.status === 422) return failure.message || t('projects.copy.invalid')
  return t('projects.copy.error')
})

function todayIso() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Seed once the source is known and the client has hydrated, so the server-rendered
// markup never disagrees with the browser-local "today".
watch([source, hydrated], ([project, ready]) => {
  if (!project || !ready || initialized.value) return
  name.value = t('projects.copy.defaultName', { name: project.name })
  startDate.value = todayIso()
  baseline.value = serialized()
  initialized.value = true
}, { immediate: true })

async function submit() {
  if (!hydrated.value || mutation.isPending.value || !initialized.value) return
  attempted.value = true
  const parsed = parsedFields.value
  if (!parsed.success) return
  try {
    const project = await mutation.mutateAsync({ id: props.sourceId, body: parsed.data })
    saved.value = true
    await nextTick()
    emit('created', project.id)
  } catch { /* A failed copy keeps the inputs and the dirty state. */ }
}
</script>

<template>
  <div class="grid gap-4" data-testid="project-copy-form">
    <p v-if="isLoading && !source" class="text-sm text-muted" data-testid="project-copy-loading">{{ t('projects.create.loading') }}</p>
    <div v-else-if="error && !source" role="alert" class="grid gap-2" data-testid="project-copy-source-error">
      <p class="text-sm text-error">{{ forbidden ? t('projects.copy.sourceUnavailable') : t('projects.copy.loadError') }}</p>
      <div class="flex gap-2">
        <UButton v-if="!forbidden" type="button" color="neutral" size="sm" variant="outline" :disabled="!hydrated" data-testid="project-copy-retry" :label="t('projects.create.retry')" @click="refetch()" />
        <UButton type="button" color="neutral" size="sm" variant="outline" :label="t('app.cancel')" @click="emit('cancel')" />
      </div>
    </div>
    <template v-else-if="source">
      <SharedUnsavedChanges :dirty="dirty" />
      <form novalidate class="grid max-w-xl gap-4" @submit.prevent="submit">
        <UAlert v-if="submitError" role="alert" color="error" variant="subtle" :title="submitError" data-testid="project-copy-submit-error" />
        <p class="text-sm text-muted">{{ t('projects.copy.hint') }}</p>
        <UFormField :label="t('projects.copy.source')">
          <UInput :model-value="source.name" name="copy-source" readonly class="w-full" data-testid="project-copy-source" />
        </UFormField>
        <UFormField :label="t('projects.copy.name')" required :error="fieldErrors.name">
          <UInput v-model="name" name="project-name" :disabled="!hydrated || mutation.isPending.value" required maxlength="255" class="w-full" data-testid="project-copy-name" />
        </UFormField>
        <UFormField :label="t('projects.copy.startDate')" required :error="fieldErrors.start_date">
          <SharedDateField v-model="startDate" name="project-start-date" :aria-label="t('projects.copy.startDate')" :disabled="!hydrated || mutation.isPending.value" aria-required="true" class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" type="button" :disabled="!hydrated || mutation.isPending.value" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
          <UButton type="submit" data-testid="project-copy-submit" :disabled="!hydrated || mutation.isPending.value" :loading="mutation.isPending.value">{{ t('projects.copy.submit') }}</UButton>
        </div>
      </form>
    </template>
  </div>
</template>
