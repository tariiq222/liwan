<script setup lang="ts">
import type { CustomFieldDefinitionPatchItem, CustomFieldLimits, CustomFieldType } from '@liwan/contracts'

// Edits the company's custom-field definitions: add a field, name it, order it, and edit the options of a selection or
// tags field. An existing field keeps its type, because changing it would reinterpret the values already stored; a new
// field gets its type here and the server gives both the field and each new option their keys. A removed field takes
// its saved values from every record, so it asks first.
const props = withDefaults(defineProps<{
  modelValue: CustomFieldDefinitionPatchItem[]
  /** The field types the server accepts, in its order. */
  types: CustomFieldType[]
  limits: CustomFieldLimits
  disabled?: boolean
}>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: CustomFieldDefinitionPatchItem[]] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const locked = computed(() => !hydrated.value || props.disabled)
const atMax = computed(() => props.modelValue.length >= props.limits.max_properties)
const newLabel = ref('')
const newType = ref<CustomFieldType>(props.types[0] ?? 'char')
// The position of the field whose delete confirmation is open.
const confirming = ref<number | null>(null)

const OPTION_TYPES: readonly CustomFieldType[] = ['selection', 'tags']
const TYPE_LABEL_KEYS: Record<CustomFieldType, string> = {
  char: 'customFields.types.char',
  text: 'customFields.types.text',
  integer: 'customFields.types.integer',
  float: 'customFields.types.float',
  boolean: 'customFields.types.boolean',
  date: 'customFields.types.date',
  datetime: 'customFields.types.datetime',
  selection: 'customFields.types.selection',
  tags: 'customFields.types.tags',
}

const typeItems = computed(() => props.types.map(value => ({ value, label: t(TYPE_LABEL_KEYS[value]) })))
const carriesOptions = (type: CustomFieldType) => OPTION_TYPES.includes(type)

function commit(next: CustomFieldDefinitionPatchItem[]) {
  emit('update:modelValue', next)
}
function replace(index: number, field: CustomFieldDefinitionPatchItem) {
  commit(props.modelValue.map((current, position) => (position === index ? field : current)))
}
function rename(index: number, label: string) {
  const field = props.modelValue[index]
  if (field) replace(index, { ...field, label })
}
function setType(index: number, type: CustomFieldType) {
  const field = props.modelValue[index]
  if (!field || field.type === type) return
  const next: CustomFieldDefinitionPatchItem = { ...field, type }
  if (carriesOptions(type)) next.options = field.options?.length ? field.options : [{ label: '' }]
  else delete next.options
  replace(index, next)
}
function move(index: number, step: -1 | 1) {
  const target = index + step
  if (target < 0 || target >= props.modelValue.length) return
  const next = [...props.modelValue]
  next.splice(target, 0, next.splice(index, 1)[0]!)
  confirming.value = null
  commit(next)
}
function remove(index: number) {
  commit(props.modelValue.filter((_, position) => position !== index))
  confirming.value = null
}
function add() {
  const label = newLabel.value.trim()
  if (!label || locked.value || atMax.value) return
  const field: CustomFieldDefinitionPatchItem = { label, type: newType.value }
  if (carriesOptions(newType.value)) field.options = [{ label: '' }]
  commit([...props.modelValue, field])
  newLabel.value = ''
}
function setNewType(type: CustomFieldType) {
  newType.value = type
}
function setOptionLabel(index: number, optionIndex: number, label: string) {
  const field = props.modelValue[index]
  if (!field?.options) return
  replace(index, { ...field, options: field.options.map((option, position) => (position === optionIndex ? { ...option, label } : option)) })
}
function addOption(index: number) {
  const field = props.modelValue[index]
  if (!field?.options || field.options.length >= props.limits.max_options) return
  replace(index, { ...field, options: [...field.options, { label: '' }] })
}
function removeOption(index: number, optionIndex: number) {
  const field = props.modelValue[index]
  // A selection or tags field keeps at least one option, as the server requires.
  if (!field?.options || field.options.length <= 1) return
  replace(index, { ...field, options: field.options.filter((_, position) => position !== optionIndex) })
}
</script>

<template>
  <div class="grid gap-4" data-testid="custom-fields-editor">
    <p v-if="!modelValue.length" class="text-sm text-muted">{{ t('customFields.empty') }}</p>
    <ul v-else class="grid gap-3">
      <SharedSubCard v-for="(field, index) in modelValue" :key="field.key ?? `new-${index}`" as="li" class="grid gap-3">
        <div class="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
          <UFormField :label="t('customFields.label')" :name="`custom-field-${index}-label`" :error="field.label.trim() ? undefined : t('customFields.labelRequired')">
            <UInput :id="`custom-field-${index}-label`" :model-value="field.label" class="w-full" :maxlength="limits.max_label" :disabled="locked" @update:model-value="value => rename(index, String(value ?? ''))" />
          </UFormField>
          <UFormField :label="t('customFields.type')" :name="`custom-field-${index}-type`">
            <USelect :id="`custom-field-${index}-type`" :model-value="field.type" class="w-full" :items="typeItems" :disabled="locked || !!field.key" @update:model-value="value => setType(index, value as CustomFieldType)" />
          </UFormField>
          <div class="flex items-center gap-1 sm:pt-6">
            <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-up" :aria-label="t('customFields.moveUp', { label: field.label })" :disabled="locked || index === 0" @click="move(index, -1)" />
            <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-chevron-down" :aria-label="t('customFields.moveDown', { label: field.label })" :disabled="locked || index === modelValue.length - 1" @click="move(index, 1)" />
            <UButton type="button" color="error" variant="ghost" size="sm" square icon="i-lucide-trash-2" :aria-label="t('customFields.remove', { label: field.label })" :disabled="locked" @click="confirming = index" />
          </div>
        </div>
        <SharedInlineConfirm
          v-if="confirming === index"
          :title="t('customFields.removeTitle', { label: field.label })"
          :description="t('customFields.removeBody')"
          :confirm-label="t('customFields.removeConfirm')"
          @cancel="confirming = null"
          @confirm="remove(index)"
        />
        <div v-if="field.options" class="grid gap-2 border-t border-default pt-3">
          <span class="text-sm font-medium text-highlighted">{{ t('customFields.options') }}</span>
          <div v-for="(option, optionIndex) in field.options" :key="option.key ?? `option-${optionIndex}`" class="flex items-start gap-2">
            <UFormField class="min-w-0 flex-1" :name="`custom-field-${index}-option-${optionIndex}`" :error="option.label.trim() ? undefined : t('customFields.optionRequired')">
              <UInput :id="`custom-field-${index}-option-${optionIndex}`" :model-value="option.label" class="w-full" :maxlength="limits.max_label" :aria-label="t('customFields.option')" :disabled="locked" @update:model-value="value => setOptionLabel(index, optionIndex, String(value ?? ''))" />
            </UFormField>
            <UButton type="button" color="neutral" variant="ghost" size="sm" square icon="i-lucide-x" :aria-label="t('customFields.removeOption', { label: option.label })" :disabled="locked || field.options.length <= 1" @click="removeOption(index, optionIndex)" />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :label="t('customFields.addOption')" :disabled="locked || field.options.length >= limits.max_options" @click="addOption(index)" />
            <span v-if="field.options.length >= limits.max_options" class="text-xs text-muted">{{ t('customFields.optionsLimit', { max: limits.max_options }) }}</span>
          </div>
        </div>
      </SharedSubCard>
    </ul>
    <div v-if="!disabled" class="grid items-start gap-2 border-t border-default pt-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
      <UFormField :label="t('customFields.newLabel')" name="custom-field-new-label">
        <UInput id="custom-field-new-label" v-model="newLabel" class="w-full" :maxlength="limits.max_label" :disabled="locked || atMax" />
      </UFormField>
      <UFormField :label="t('customFields.type')" name="custom-field-new-type">
        <USelect id="custom-field-new-type" :model-value="newType" class="w-full" :items="typeItems" :disabled="locked || atMax" @update:model-value="value => setNewType(value as CustomFieldType)" />
      </UFormField>
      <UButton type="button" class="sm:mt-6" icon="i-lucide-plus" :label="t('customFields.add')" :disabled="locked || atMax || !newLabel.trim()" @click="add" />
    </div>
    <p v-if="atMax" class="text-sm text-muted">{{ t('customFields.limitReached', { max: limits.max_properties }) }}</p>
  </div>
</template>
