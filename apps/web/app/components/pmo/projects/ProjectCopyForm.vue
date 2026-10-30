<script setup lang="ts">
import { ProjectCopyInputSchema } from '@liwan/contracts'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
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
const endDate = ref<string | null>(null)
// The server asks for an end date (422 on `end_date`) when the source has none and the company requires one.
const needsEndDate = computed(() => {
  const failure = mutation.error.value
  return failure instanceof ApiError && failure.status === 422 && failure.field === 'end_date'
})
const askEndDate = ref(false)
watch(needsEndDate, (needed) => { if (needed) askEndDate.value = true })
const baseline = ref('')
const initialized = ref(false)
const saved = ref(false)
const attempted = ref(false)

const serialized = () => JSON.stringify({ name: name.value, start_date: startDate.value, end_date: endDate.value })
const dirty = computed(() => initialized.value && !saved.value && serialized() !== baseline.value)
const parsedFields = computed(() => ProjectCopyInputSchema.safeParse({ name: name.value, start_date: startDate.value, ...(askEndDate.value && endDate.value ? { end_date: endDate.value } : {}) }))
const fieldErrors = computed(() => {
  if (!attempted.value || parsedFields.value.success) return {}
  const issues = parsedFields.value.error.issues
  return {
    name: issues.some(issue => issue.path[0] === 'name') ? t('projects.copy.validation.name') : undefined,
    start_date: issues.some(issue => issue.path[0] === 'start_date') ? t('projects.copy.validation.startDate') : undefined,
    end_date: issues.some(issue => issue.path[0] === 'end_date') ? t('projects.copy.validation.endDate') : undefined,
  }
})
const forbidden = computed(() => error.value instanceof ApiError && (error.value.status === 403 || error.value.status === 404))
const submitError = computed(() => {
  const failure = mutation.error.value
  if (!failure) return null
  if (failure instanceof ApiError && failure.status === 403) {
    // $api already turns a structured quota denial into the plan-limit message.
    return failure.code === 'feature_not_included' && failure.details?.reason === 'limit' ? failure.message : t('projects.copy.forbidden')
  }
  if (needsEndDate.value) return t('projects.copy.endDateRequired')
  if (failure instanceof ApiError && failure.status === 422) return failure.message || t('projects.copy.invalid')
  return t('projects.copy.error')
})

// Seed once the source is known and the client has hydrated, so the server-rendered
// markup never disagrees with the browser-local "today".
watch([source, hydrated], ([project, ready]) => {
  if (!project || !ready || initialized.value) return
  name.value = t('projects.copy.defaultName', { name: project.name })
  startDate.value = localIsoDay()
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
  <div class="liwan-form" data-testid="project-copy-form">
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
      <form novalidate class="liwan-form" @submit.prevent="submit">
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
        <UFormField v-if="askEndDate" :label="t('projects.copy.endDate')" required :error="fieldErrors.end_date">
          <SharedDateField v-model="endDate" name="project-end-date" :aria-label="t('projects.copy.endDate')" :disabled="!hydrated || mutation.isPending.value" aria-required="true" class="w-full" data-testid="project-copy-end-date" />
        </UFormField>
        <SharedFormActions>
          <div class="ms-auto flex items-center gap-2">
            <UButton color="neutral" variant="outline" type="button" :disabled="!hydrated || mutation.isPending.value" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
            <UButton type="submit" data-testid="project-copy-submit" :disabled="!hydrated || mutation.isPending.value" :loading="mutation.isPending.value">{{ t('projects.copy.submit') }}</UButton>
          </div>
        </SharedFormActions>
      </form>
    </template>
  </div>
</template>
