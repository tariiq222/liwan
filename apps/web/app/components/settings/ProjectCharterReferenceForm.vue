<script setup lang="ts">
import type { ProjectCharterReference } from '@nasq/contracts'
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
const name = ref(props.reference?.name ?? '')
const sequence = ref(props.reference ? String(props.reference.sequence) : '')
const baselineName = ref(name.value)
const baselineSequence = ref(sequence.value)
const submitted = ref(false)
const error = ref<string | null>(null)
const { mutateAsync: createReference, isPending: creating } = useCreateCharterReference(() => props.resource)
const { mutateAsync: updateReference, isPending: updating } = useUpdateCharterReference(() => props.resource)
const pending = computed(() => creating.value || updating.value)
const dirty = computed(() => !submitted.value && (name.value !== baselineName.value || sequence.value !== baselineSequence.value))

watch(
  () => props.reference,
  (reference) => {
    name.value = reference?.name ?? ''
    sequence.value = reference ? String(reference.sequence) : ''
    baselineName.value = name.value
    baselineSequence.value = sequence.value
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
    const body = parsedSequence === undefined ? { name: trimmed } : { name: trimmed, sequence: parsedSequence }
    const savedReference = props.reference
      ? await updateReference({ id: props.reference.id, patch: body })
      : await createReference(body)
    baselineName.value = name.value
    baselineSequence.value = sequence.value
    submitted.value = true
    emit('saved', savedReference)
  }
  catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form class="nasq-form grid gap-4" data-testid="charter-reference-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="grid gap-2">
      <label for="catalog-name" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.catalogs.name') }}</label>
      <UInput id="catalog-name" v-model="name" class="w-full" required :disabled="!hydrated || pending" />
    </div>
    <div class="grid gap-2">
      <label for="catalog-sequence" class="flex items-center gap-2 text-sm font-medium leading-none">{{ t('settings.projects.catalogs.sequence') }}</label>
      <UInput id="catalog-sequence" v-model="sequence" class="w-full" inputmode="numeric" dir="ltr" :disabled="!hydrated || pending" />
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" :disabled="!hydrated || pending || !name.trim()" :label="reference ? t('app.save') : t('app.create')" />
    </div>
  </form>
</template>
