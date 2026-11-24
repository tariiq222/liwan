<script setup lang="ts">
/*
 * A list of money amounts, one amount per row (DESIGN.md §6): every row is a `SharedMoneyField`, so each carries its own
 * label, unit and error and a mistake points at one row, never at a comma-separated line. The reader adds and removes
 * rows with labelled buttons (icon and text, never an icon alone); the list never goes below `min` rows. A new row takes
 * focus. A required list shows one asterisk (the list's); the rows keep `required` for `aria-required` and hide their own. `errors[i]` is row i's message; `error` is the list's own (count, order). All text arrives as props.
 */
import MoneyField from './MoneyField.vue'

const rows = defineModel<string[]>({ required: true })
const props = withDefaults(defineProps<{
  label: string
  unit: string
  unitLabel?: string
  /** Names row n for the reader and the screen reader: `${rowLabel} ${n}`. */
  rowLabel: string
  addLabel: string
  removeLabel: string
  name?: string
  help?: string
  required?: boolean
  /** The list's own message (too many rows, wrong order). */
  error?: string | false
  /** One message per row, by index. */
  errors?: Array<string | undefined>
  submitted?: boolean
  disabled?: boolean
  min?: number
  max?: number
}>(), { min: 1 })

/*
 * Each row keeps a stable id as its `:key`, so a row's internal state (FormField `touched`) follows the row, not its
 * position. The ids are maintained on add/remove; an outside change of the row count (reset) is reconciled below.
 */
let nextRowId = 0
const rowIds = ref<number[]>(rows.value.map(() => nextRowId++))
watch(() => rows.value.length, (length) => {
  if (rowIds.value.length < length) rowIds.value = [...rowIds.value, ...Array.from({ length: length - rowIds.value.length }, () => nextRowId++)]
  else if (rowIds.value.length > length) rowIds.value = rowIds.value.slice(0, length)
})
const id = `money-list-${useId()}`
const canAdd = computed(() => !props.disabled && (props.max === undefined || rows.value.length < props.max))
const canRemove = computed(() => !props.disabled && rows.value.length > props.min)
const describedBy = computed(() => [props.help ? `${id}-help` : '', props.error && props.submitted ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined)

function patch(index: number, value: string) {
  rows.value = rows.value.map((row, i) => (i === index ? value : row))
}
const rowFields: Array<{ $el: HTMLElement } | null> = []
function setRowField(index: number, field: unknown) {
  rowFields[index] = (field as { $el: HTMLElement } | null) ?? null
}
async function focusRow(index: number) {
  await nextTick()
  const target = rowFields[Math.max(0, Math.min(index, rows.value.length - 1))]
  target?.$el?.querySelector?.('input')?.focus()
}
/*
 * Pressing a mouse button on add/remove must not move focus: the blur would mark another row touched, its error line
 * would appear and shift every row below, so the button leaves the cursor before `click` fires (the first click is lost).
 * Click and keyboard activation are unaffected.
 */
function preventBlur(event: MouseEvent) {
  event.preventDefault()
}
function add() {
  // `rows` is a defineModel: its value only changes after the parent re-renders, so take the index before assigning.
  const index = rows.value.length
  rowIds.value = [...rowIds.value, nextRowId++]
  rows.value = [...rows.value, '']
  void focusRow(index)
}
function remove(index: number) {
  rowIds.value = rowIds.value.filter((_, i) => i !== index)
  rows.value = rows.value.filter((_, i) => i !== index)
  void focusRow(index)
}
</script>

<template>
  <div
    :id="props.name ? `field-${props.name}` : undefined"
    role="group"
    class="grid gap-3"
    :aria-labelledby="`${id}-label`"
    :aria-describedby="describedBy"
    :data-field="props.name"
    data-slot="money-list"
  >
    <div>
      <p :id="`${id}-label`" class="text-sm font-medium text-highlighted">{{ props.label }}<span v-if="props.required" class="text-error" aria-hidden="true"> *</span></p>
      <p v-if="props.help" :id="`${id}-help`" class="mt-1 text-sm text-muted">{{ props.help }}</p>
    </div>
    <MoneyField
      v-for="(row, index) in rows"
      :key="rowIds[index] ?? index"
      :ref="(field) => setRowField(index, field)"
      :model-value="row"
      :label="`${props.rowLabel} ${index + 1}`"
      :unit="props.unit"
      :unit-label="props.unitLabel"
      :required="props.required"
      :ui="{ label: 'after:hidden' }"
      :error="props.errors?.[index]"
      :submitted="props.submitted"
      :disabled="props.disabled"
      @update:model-value="patch(index, $event)"
    >
      <template #after>
        <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :label="props.removeLabel" :aria-label="`${props.removeLabel} ${props.rowLabel} ${index + 1}`" :disabled="!canRemove" @mousedown="preventBlur" @click="remove(index)" />
      </template>
    </MoneyField>
    <p v-if="props.error && props.submitted" :id="`${id}-error`" class="text-sm text-error">{{ props.error }}</p>
    <div>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :label="props.addLabel" :disabled="!canAdd" @mousedown="preventBlur" @click="add" />
    </div>
  </div>
</template>
