<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { usePeople } from '@/composables/usePeople'

export interface PickedPerson { id: number; name: string }

// The one picker for choosing people from /api/v1/people. `valueKey` chooses
// which id the model carries: `user_id` (res.users) for meetings and charter
// roles, `id` for task assignees. `known` supplies names for ids that are
// selected but not in the current search results. `options` restricts the
// choice to a fixed list (for example a meeting's participants) and searches
// it locally instead of calling the people API.
const props = withDefaults(defineProps<{
  modelValue: number | number[] | null
  multiple?: boolean
  known?: PickedPerson[]
  valueKey?: 'id' | 'user_id'
  placeholder?: string
  disabled?: boolean
  exclude?: number[]
  options?: PickedPerson[]
  id?: string
  ariaLabel?: string
  ariaLabelledby?: string
}>(), { valueKey: 'id', multiple: false })
const emit = defineEmits<{
  'update:modelValue': [value: number | number[] | null]
  resolve: [people: PickedPerson[]]
}>()

const { t } = useI18n()
const hydrated = useHydrated()
const q = ref('')
const search = refDebounced(q, 250)
const { data: remotePeople } = usePeople(search, computed(() => !props.options))
const people = computed(() => props.options
  ? props.options
    .filter(person => !q.value.trim() || person.name.toLowerCase().includes(q.value.trim().toLowerCase()))
    .map(person => ({ id: person.id, user_id: person.id, name: person.name }))
  : remotePeople.value)

const names = ref(new Map<number, string>())
watch([() => props.known, people], () => {
  const next = new Map(names.value)
  for (const person of props.known ?? []) next.set(person.id, person.name)
  for (const person of people.value ?? []) next.set(person[props.valueKey], person.name)
  names.value = next
}, { immediate: true, deep: true })

const selectedIds = computed(() => props.modelValue === null ? [] : Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue])
const items = computed(() => {
  const excluded = new Set(props.exclude ?? [])
  const seen = new Set<number>()
  const rows: { label: string; value: number }[] = []
  const push = (id: number) => {
    if (seen.has(id) || excluded.has(id)) return
    seen.add(id)
    rows.push({ label: names.value.get(id) ?? `#${id}`, value: id })
  }
  selectedIds.value.forEach(push)
  for (const person of people.value ?? []) push(person[props.valueKey])
  return rows
})

function onChange(value: unknown) {
  const next = props.multiple ? (value as number[]) : (value as number | null | undefined) ?? null
  emit('update:modelValue', next)
  const ids = next === null ? [] : Array.isArray(next) ? next : [next]
  emit('resolve', ids.map(id => ({ id, name: names.value.get(id) ?? `#${id}` })))
}
</script>

<template>
  <USelectMenu
    :id="props.id"
    v-model:search-term="q"
    :model-value="props.multiple ? selectedIds : (props.modelValue ?? undefined)"
    :items="items"
    value-key="value"
    :multiple="props.multiple"
    :ignore-filter="true"
    :placeholder="props.placeholder ?? t('app.selectPerson')"
    :search-input="{ placeholder: t('app.search') }"
    :disabled="props.disabled || !hydrated"
    :aria-label="props.ariaLabel"
    :aria-labelledby="props.ariaLabelledby"
    class="w-full"
    data-testid="person-picker"
    @update:model-value="onChange"
  />
</template>
