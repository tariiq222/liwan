<script setup lang="ts">
import type { CustomFieldValue, CustomFieldValues, CustomFieldWithValue } from '@liwan/contracts'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { fromUtcDateTimeInput, toUtcDateTime } from '@/utils/meetingDateTime'
import { joinList } from '@/utils/listFormat'

// The company's custom fields of one record, as rows inside SharedPropertiesPanel. Read mode prints each value, a
// selection or tags field by its option labels and a boolean in the reader's language; edit mode holds a draft of the
// whole set and reports only the keys whose value differs from the record's, which is the partial object a PATCH sends.
const props = withDefaults(defineProps<{
  fields: CustomFieldWithValue[]
  editable: boolean
  /** A server refusal per field key, shown under that field's control. */
  errors?: Record<string, string>
}>(), { errors: () => ({}) })
const emit = defineEmits<{
  'update:dirty': [dirty: boolean]
  change: [values: CustomFieldValues]
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const locked = computed(() => !hydrated.value || !props.editable)

const baseline = computed<CustomFieldValues>(() => Object.fromEntries(props.fields.map(field => [field.key, field.value] as const)))
const draft = ref<CustomFieldValues>({ ...baseline.value })
// The record's own definition and values: a refetch (or another edit's saved response) replaces the draft.
const signature = computed(() => JSON.stringify(props.fields.map(field => [field.key, field.type, field.options, field.value])))
const changed = computed<CustomFieldValues>(() => Object.fromEntries(
  Object.entries(draft.value).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline.value[key])),
))
const dirty = computed(() => Object.keys(changed.value).length > 0)

watch(signature, () => {
  draft.value = { ...baseline.value }
  emit('update:dirty', false)
}, { immediate: true })

function setValue(key: string, value: CustomFieldValue) {
  draft.value = { ...draft.value, [key]: value }
  emit('update:dirty', dirty.value)
  emit('change', changed.value)
}

const optionItems = (field: CustomFieldWithValue) => (field.options ?? []).map(option => ({ value: option.key, label: option.label }))
const optionLabel = (field: CustomFieldWithValue, key: string) => field.options?.find(option => option.key === key)?.label ?? key

function display(field: CustomFieldWithValue): string | null {
  const value = field.value
  if (field.type === 'boolean') return value ? t('customFields.yes') : t('customFields.no')
  if (field.type === 'tags') {
    const keys = Array.isArray(value) ? value : []
    return keys.length ? joinList(keys.map(key => optionLabel(field, key)), t) : null
  }
  if (value === null || value === '') return null
  if (field.type === 'selection') return optionLabel(field, String(value))
  if (field.type === 'date') return formatLiwanDate(String(value))
  if (field.type === 'datetime') return formatLiwanDateTime(String(value))
  return String(value)
}

const current = (field: CustomFieldWithValue) => draft.value[field.key] ?? field.value
const text = (value: CustomFieldValue) => (typeof value === 'string' ? value : '')
const number = (value: CustomFieldValue) => (typeof value === 'number' ? value : null)
const selected = (value: CustomFieldValue) => (typeof value === 'string' ? value : undefined)
const tags = (value: CustomFieldValue) => (Array.isArray(value) ? value : [])

/** A UTC instant as the value of a `datetime-local` input in the browser's own time zone. */
function toLocalInput(value: CustomFieldValue): string {
  return fromUtcDateTimeInput(typeof value === 'string' ? value : null)
}
/** The local time the reader picked, as the UTC instant the server stores; null while empty or invalid. */
function toUtcInstant(value: string): string | null {
  return toUtcDateTime(value) ?? null
}

/** A whole-number field stores what the server accepts: an integer, never a fraction. */
function setNumber(key: string, type: CustomFieldWithValue['type'], value: number | null | undefined) {
  if (value === null || value === undefined) return setValue(key, null)
  setValue(key, type === 'integer' ? Math.round(value) : value)
}

// A selection field clears to null: the server accepts an option key or null. The select needs a non-empty item value
// for "no option" (an empty one is reserved by the select itself), and server keys are hex, so this never collides.
const NO_OPTION = '__none__'
const clearableOptions = (field: CustomFieldWithValue) => [{ value: NO_OPTION, label: t('customFields.noOption') }, ...optionItems(field)]

function selectOption(key: string, value: string) {
  setValue(key, value === NO_OPTION ? null : value)
}
</script>

<template>
  <template v-for="field in fields" :key="field.key">
    <SharedPropertyRow v-if="locked" :label="field.label" :value="display(field)" />
    <SharedPropertyRow v-else :label="field.label">
      <div class="grid gap-1">
        <UInput
          v-if="field.type === 'char'"
          :model-value="text(current(field))"
          class="w-full"
          :maxlength="255"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, String(value ?? '') || null)"
        />
        <UTextarea
          v-else-if="field.type === 'text'"
          :model-value="text(current(field))"
          class="w-full"
          :maxlength="5000"
          :rows="3"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, String(value ?? '') || null)"
        />
        <UInputNumber
          v-else-if="field.type === 'integer' || field.type === 'float'"
          :model-value="number(current(field))"
          class="w-full"
          :step="field.type === 'integer' ? 1 : undefined"
          :aria-label="field.label"
          @update:model-value="value => setNumber(field.key, field.type, value)"
        />
        <USwitch
          v-else-if="field.type === 'boolean'"
          :model-value="!!current(field)"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, !!value)"
        />
        <SharedDateField
          v-else-if="field.type === 'date'"
          :id="`custom-field-${field.key}`"
          :model-value="typeof current(field) === 'string' ? (current(field) as string) : null"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, value)"
        />
        <UInput
          v-else-if="field.type === 'datetime'"
          :id="`custom-field-${field.key}`"
          :model-value="toLocalInput(current(field))"
          type="datetime-local"
          dir="ltr"
          class="w-full"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, toUtcInstant(String(value ?? '')))"
        />
        <USelect
          v-else-if="field.type === 'selection'"
          :id="`custom-field-${field.key}`"
          :model-value="selected(current(field)) ?? NO_OPTION"
          class="w-full"
          :items="clearableOptions(field)"
          :aria-label="field.label"
          @update:model-value="value => selectOption(field.key, String(value ?? NO_OPTION))"
        />
        <USelectMenu
          v-else-if="field.type === 'tags'"
          :id="`custom-field-${field.key}`"
          :model-value="tags(current(field))"
          class="w-full"
          multiple
          value-key="value"
          :items="optionItems(field)"
          :placeholder="t('customFields.chooseOptions')"
          :aria-label="field.label"
          @update:model-value="value => setValue(field.key, (value as string[]) ?? [])"
        />
        <p v-if="errors[field.key]" role="alert" class="text-sm text-error">{{ errors[field.key] }}</p>
      </div>
    </SharedPropertyRow>
  </template>
</template>
