<script setup lang="ts">
import {
  FLOW_FIELD_ICON, FLOW_INPUT_TYPES, FLOW_LIMITS, canBeSensitive, emptyOption, isChoiceKind, isDisplayKind, isInputKind, moveToIndex,
  type FlowFieldDraft, type FlowProblem,
} from '@/composables/inbox/inboxFlow'

// One component of a screen: a text to show (heading, subheading, text, caption) or a question to answer (a typed field,
// a choice or a date). Every text shows its Meta limit as a live counter. The answer's key is generated (`field_<n>`) and
// edited under "advanced", because Arabic labels cannot be slugged. A problem found by the contract or by Meta is shown
// under the field it belongs to.
const field = defineModel<FlowFieldDraft>({ required: true })
const props = defineProps<{ index: number; count: number; disabled?: boolean; problems?: FlowProblem[]; metaErrors?: string[] }>()
const emit = defineEmits<{ move: [step: -1 | 1]; remove: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const advanced = ref(false)
const off = computed(() => !hydrated.value || !!props.disabled)
const counter = (value: string, max: number) => `${value.length}/${max}`
const display = computed(() => isDisplayKind(field.value.kind))
const labelMax = computed(() => (isInputKind(field.value.kind) ? FLOW_LIMITS.label[field.value.kind as keyof typeof FLOW_LIMITS.label] : 0))
const textMax = computed(() => (isDisplayKind(field.value.kind) ? FLOW_LIMITS.text[field.value.kind] : 0))
const optionMax = computed(() => (isChoiceKind(field.value.kind) ? FLOW_LIMITS.options[field.value.kind] : 0))
const choice = computed(() => isChoiceKind(field.value.kind))
const hasHelper = computed(() => ['text_input', 'text_area', 'date'].includes(field.value.kind))
const messages = computed(() => [...new Set((props.problems ?? []).map(problem => t(problem.code === 'invalid' ? `inbox.flows.problem.invalid${problem.prop ? 'Prop' : ''}` : `inbox.flows.problem.${problem.code}`, { prop: problem.prop ? t(`inbox.flows.prop.${problem.prop}`) : '' })))])
const flagged = (prop: string) => !!props.problems?.some(problem => problem.prop === prop)

function addOption() {
  if (field.value.options.length < optionMax.value) field.value.options.push(emptyOption())
}
function removeOption(position: number) {
  if (field.value.options.length > 1) field.value.options.splice(position, 1)
}
function moveOption(position: number, step: -1 | 1) {
  field.value.options = moveToIndex(field.value.options, position, position + step)
}
</script>

<template>
  <div class="flex flex-col gap-3" :data-testid="`inbox-flow-field-${props.index}`">
    <div class="flex items-center gap-2">
      <UIcon :name="FLOW_FIELD_ICON[field.kind]" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ t(`inbox.flows.kind.${field.kind}`) }}</span>
      <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :aria-label="t('inbox.flows.builder.moveUp')" :disabled="off || props.index === 0" @click="emit('move', -1)" />
      <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :aria-label="t('inbox.flows.builder.moveDown')" :disabled="off || props.index === props.count - 1" @click="emit('move', 1)" />
      <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('inbox.flows.builder.removeField')" :disabled="off" @click="emit('remove')" />
    </div>

    <UFormField v-if="display" :label="t('inbox.flows.field.text')" required :error="flagged('text') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.text') }) : undefined">
      <UTextarea v-model="field.text" class="w-full" :rows="field.kind === 'text' ? 3 : 1" autoresize :maxlength="textMax" :disabled="off" :data-testid="`inbox-flow-field-${props.index}-text`" />
      <template #hint><span class="text-xs text-muted">{{ counter(field.text, textMax) }}</span></template>
    </UFormField>

    <template v-else>
      <UFormField :label="t('inbox.flows.field.label')" required :error="flagged('label') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.label') }) : undefined">
        <UInput v-model="field.label" class="w-full" :maxlength="labelMax" :disabled="off" :data-testid="`inbox-flow-field-${props.index}-label`" />
        <template #hint><span class="text-xs text-muted">{{ counter(field.label, labelMax) }}</span></template>
      </UFormField>

      <UFormField v-if="field.kind === 'text_input'" :label="t('inbox.flows.field.inputType')">
        <USelect v-model="field.inputType" :items="FLOW_INPUT_TYPES.map(value => ({ value, label: t(`inbox.flows.inputType.${value}`) }))" class="w-full" :disabled="off" />
      </UFormField>
      <UFormField v-if="hasHelper" :label="t('inbox.flows.field.helper')" :error="flagged('helper_text') ? t('inbox.flows.problem.invalidProp', { prop: t('inbox.flows.prop.helper_text') }) : undefined">
        <UInput v-model="field.helperText" class="w-full" :maxlength="FLOW_LIMITS.helperText" :disabled="off" />
        <template #hint><span class="text-xs text-muted">{{ counter(field.helperText, FLOW_LIMITS.helperText) }}</span></template>
      </UFormField>

      <div v-if="field.kind === 'text_input'" class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('inbox.flows.field.minChars')"><UInput v-model="field.minChars" type="number" inputmode="numeric" min="1" :max="FLOW_LIMITS.maxChars" class="w-full" :disabled="off" /></UFormField>
        <UFormField :label="t('inbox.flows.field.maxChars')" :description="t('inbox.flows.field.maxCharsHint')"><UInput v-model="field.maxChars" type="number" inputmode="numeric" min="1" :max="FLOW_LIMITS.maxChars" class="w-full" :disabled="off" /></UFormField>
      </div>
      <UFormField v-if="field.kind === 'text_area'" :label="t('inbox.flows.field.maxLength')" :description="t('inbox.flows.field.maxLengthHint', { max: FLOW_LIMITS.maxLength })">
        <UInput v-model="field.maxLength" type="number" inputmode="numeric" min="1" :max="FLOW_LIMITS.maxLength" class="w-full" :disabled="off" />
      </UFormField>
      <div v-if="field.kind === 'date'" class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('inbox.flows.field.minDate')"><SharedDateField v-model="field.minDate" :disabled="off" :aria-label="t('inbox.flows.field.minDate')" /></UFormField>
        <UFormField :label="t('inbox.flows.field.maxDate')"><SharedDateField v-model="field.maxDate" :disabled="off" :aria-label="t('inbox.flows.field.maxDate')" /></UFormField>
      </div>

      <div v-if="choice" class="flex flex-col gap-2" :data-testid="`inbox-flow-field-${props.index}-options`">
        <p class="flex items-center justify-between text-sm font-medium">
          <span>{{ t('inbox.flows.field.options') }}</span>
          <span class="text-xs font-normal text-muted">{{ t('inbox.flows.field.optionCount', { n: field.options.length, max: optionMax }) }}</span>
        </p>
        <ol class="flex flex-col gap-2">
          <li v-for="(option, position) in field.options" :key="option.uid" class="flex flex-col gap-2 rounded-control p-2 ring ring-default">
            <div class="flex items-start gap-2">
              <UFormField class="min-w-0 flex-1" :label="t('inbox.flows.field.optionTitle', { n: position + 1 })" required>
                <UInput v-model="option.title" class="w-full" :maxlength="FLOW_LIMITS.optionTitle" :disabled="off" :data-testid="`inbox-flow-field-${props.index}-option-${position}`" />
                <template #hint><span class="text-xs text-muted">{{ counter(option.title, FLOW_LIMITS.optionTitle) }}</span></template>
              </UFormField>
              <div class="flex pt-6">
                <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :aria-label="t('inbox.flows.builder.moveUp')" :disabled="off || position === 0" @click="moveOption(position, -1)" />
                <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :aria-label="t('inbox.flows.builder.moveDown')" :disabled="off || position === field.options.length - 1" @click="moveOption(position, 1)" />
                <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('inbox.flows.field.removeOption')" :disabled="off || field.options.length <= 1" @click="removeOption(position)" />
              </div>
            </div>
            <UFormField :label="t('inbox.flows.field.optionDescription')">
              <UInput v-model="option.description" class="w-full" :maxlength="FLOW_LIMITS.optionDescription" :disabled="off" />
              <template #hint><span class="text-xs text-muted">{{ counter(option.description, FLOW_LIMITS.optionDescription) }}</span></template>
            </UFormField>
          </li>
        </ol>
        <UButton type="button" class="self-start" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :label="t('inbox.flows.field.addOption')" :disabled="off || field.options.length >= optionMax" :data-testid="`inbox-flow-field-${props.index}-add-option`" @click="addOption" />
      </div>
      <div v-if="field.kind === 'checkbox'" class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('inbox.flows.field.minSelected')"><UInput v-model="field.minSelected" type="number" inputmode="numeric" min="1" :max="FLOW_LIMITS.selected" class="w-full" :disabled="off" /></UFormField>
        <UFormField :label="t('inbox.flows.field.maxSelected')"><UInput v-model="field.maxSelected" type="number" inputmode="numeric" min="1" :max="FLOW_LIMITS.selected" class="w-full" :disabled="off" /></UFormField>
      </div>

      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label class="flex items-center gap-2 text-sm"><USwitch v-model="field.required" :disabled="off" />{{ t('inbox.flows.field.required') }}</label>
        <label v-if="canBeSensitive(field.kind)" class="flex items-center gap-2 text-sm"><USwitch v-model="field.sensitive" :disabled="off" />{{ t('inbox.flows.field.sensitive') }}</label>
        <UButton type="button" class="ms-auto" color="neutral" variant="link" size="sm" :label="t('inbox.flows.field.advanced')" :aria-expanded="advanced" @click="advanced = !advanced" />
      </div>
      <p v-if="field.sensitive" class="text-xs text-muted">{{ t('inbox.flows.field.sensitiveHint') }}</p>
      <UFormField v-if="advanced" :label="t('inbox.flows.field.key')" :description="t('inbox.flows.field.keyHint')" :error="flagged('key') ? t('inbox.flows.problem.key') : undefined">
        <UInput v-model="field.key" class="w-full" dir="ltr" :maxlength="FLOW_LIMITS.key" :disabled="off" :data-testid="`inbox-flow-field-${props.index}-key`" />
      </UFormField>
    </template>

    <ul v-if="messages.length || props.metaErrors?.length" class="flex flex-col gap-0.5 text-xs text-error" role="alert" :data-testid="`inbox-flow-field-${props.index}-problems`">
      <li v-for="message in messages" :key="message">{{ message }}</li>
      <li v-for="message in props.metaErrors" :key="message" dir="auto">{{ t('inbox.flows.meta.says') }} {{ message }}</li>
    </ul>
  </div>
</template>
