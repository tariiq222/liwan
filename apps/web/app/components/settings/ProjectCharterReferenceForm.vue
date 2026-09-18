<script setup lang="ts">
import { PROJECT_CHARTER_STEPS, type ProjectCharterReference, type ProjectCharterStep } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import {
  useCreateCharterReference,
  useUpdateCharterReference,
  type ProjectCharterCatalogResource,
} from '@/composables/useProjectCharterCatalogs'

const props = defineProps<{
  resource: ProjectCharterCatalogResource
  reference?: ProjectCharterReference
}>()

const emit = defineEmits<{ saved: [ProjectCharterReference]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
// Only a project type carries charter steps; a new type walks every step.
const hasSteps = computed(() => props.resource === 'types')
function initialSteps(reference?: ProjectCharterReference): ProjectCharterStep[] {
  return reference?.charter_steps ? [...reference.charter_steps] : [...PROJECT_CHARTER_STEPS]
}
const name = ref(props.reference?.name ?? '')
const sequence = ref(props.reference ? String(props.reference.sequence) : '')
const steps = ref<ProjectCharterStep[]>(initialSteps(props.reference))
const baselineName = ref(name.value)
const baselineSequence = ref(sequence.value)
const baselineSteps = ref(steps.value.join(','))
const submitted = ref(false)
const error = ref<string | null>(null)
const { mutateAsync: createReference, isPending: creating } = useCreateCharterReference(() => props.resource)
const { mutateAsync: updateReference, isPending: updating } = useUpdateCharterReference(() => props.resource)
const pending = computed(() => creating.value || updating.value)
const orderedSteps = computed(() => PROJECT_CHARTER_STEPS.filter(step => steps.value.includes(step)))
const stepItems = computed(() => PROJECT_CHARTER_STEPS.map(step => ({ value: step, label: t(`projects.charter.steps.${step}`) })))
const dirty = computed(() => !submitted.value && (
  name.value !== baselineName.value
  || sequence.value !== baselineSequence.value
  || (hasSteps.value && orderedSteps.value.join(',') !== baselineSteps.value)
))

function onStepsChange(value: unknown) {
  steps.value = Array.isArray(value) ? value.filter((step): step is ProjectCharterStep => (PROJECT_CHARTER_STEPS as readonly string[]).includes(String(step))) : []
}

watch(
  () => props.reference,
  (reference) => {
    name.value = reference?.name ?? ''
    sequence.value = reference ? String(reference.sequence) : ''
    steps.value = initialSteps(reference)
    baselineName.value = name.value
    baselineSequence.value = sequence.value
    baselineSteps.value = steps.value.join(',')
    submitted.value = false
  },
)

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = t('settings.projects.catalogs.errors.nameRequired')
    return
  }
  const sequenceValue = sequence.value.trim()
  let parsedSequence: number | undefined
  if (sequenceValue) {
    if (!/^-?\d+$/.test(sequenceValue)) {
      error.value = t('settings.projects.catalogs.errors.sequence')
      return
    }
    parsedSequence = Number(sequenceValue)
  }
  try {
    const body = {
      name: trimmed,
      ...(parsedSequence === undefined ? {} : { sequence: parsedSequence }),
      ...(hasSteps.value ? { charter_steps: orderedSteps.value } : {}),
    }
    const savedReference = props.reference
      ? await updateReference({ id: props.reference.id, patch: body })
      : await createReference(body)
    baselineName.value = name.value
    baselineSequence.value = sequence.value
    baselineSteps.value = orderedSteps.value.join(',')
    submitted.value = true
    emit('saved', savedReference)
  }
  catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form class="nasq-form" data-testid="charter-reference-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UFormField :label="t('settings.projects.catalogs.name')" required>
      <UInput id="catalog-name" v-model="name" class="w-full" required :disabled="!hydrated || pending" />
    </UFormField>
    <UFormField :label="t('settings.projects.catalogs.sequence')">
      <UInput id="catalog-sequence" v-model="sequence" class="w-full" inputmode="numeric" dir="ltr" :disabled="!hydrated || pending" />
    </UFormField>
    <UFormField v-if="hasSteps" :label="t('settings.projects.catalogs.charterSteps')" :hint="t('settings.projects.catalogs.charterStepsHint')" data-testid="catalog-charter-steps">
      <UCheckboxGroup
        :model-value="orderedSteps"
        :items="stepItems"
        value-key="value"
        label-key="label"
        :disabled="!hydrated || pending"
        @update:model-value="onStepsChange"
      />
    </UFormField>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <footer class="nasq-form-footer justify-end">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" :disabled="!hydrated || pending || !name.trim()" :label="reference ? t('app.save') : t('app.create')" />
    </footer>
  </form>
</template>
