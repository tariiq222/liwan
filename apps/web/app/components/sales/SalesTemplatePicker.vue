<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { SalesTemplateItem } from '@liwan/contracts'
import { useSalesTemplates } from '@/composables/sales/useSalesTemplates'

// "Start from a template" on a new quotation: one choice among the active templates of the company, or none. The list is
// searched by name on the server, so a template beyond the first page is reached by typing a part of its name. A template
// that cannot start a quotation now (a product was archived) shows but cannot be chosen. The control is absent while the
// company has no template, so a tenant that does not use them never sees it.
const props = defineProps<{ modelValue: number | null; disabled?: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: number | null] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const search = ref('')
const term = refDebounced(search, 250)
const query = useSalesTemplates(computed(() => ({ q: term.value.trim(), archived: false, page: 1 })), () => can('sales.quotations.manage'))
const found = computed(() => query.data.value?.items ?? [])
// The company has templates once an unfiltered list says so; a search that finds none must not take the control away.
const hasTemplates = ref(false)
watch([found, term], () => { if (!term.value.trim() && found.value.length) hasTemplates.value = true }, { immediate: true })
// The chosen template stays in the list while a later search no longer returns it.
const remembered = ref<SalesTemplateItem | null>(null)
watch(found, (items) => {
  const match = items.find(template => template.id === props.modelValue)
  if (match) remembered.value = match
}, { immediate: true })
const chosen = computed(() => found.value.find(template => template.id === props.modelValue) ?? (remembered.value?.id === props.modelValue ? remembered.value : null))
const NONE = 0
const label = (template: SalesTemplateItem) => template.usable ? template.name : `${template.name} (${t('sales.templates.needsAttention')})`
const items = computed(() => [
  { value: NONE, label: t('sales.templates.picker.none') },
  ...(chosen.value && !found.value.some(template => template.id === chosen.value!.id) ? [{ value: chosen.value.id, label: label(chosen.value), disabled: !chosen.value.usable }] : []),
  ...found.value.map(template => ({ value: template.id, label: label(template), disabled: !template.usable })),
])
function choose(value: unknown) {
  const id = Number(value) || null
  remembered.value = found.value.find(template => template.id === id) ?? null
  emit('update:modelValue', id)
}
const hint = computed(() => chosen.value
  ? t('sales.templates.picker.chosen', { lines: t('sales.templates.lineCount', { count: chosen.value.line_count }, chosen.value.line_count), validity: chosen.value.validity_days ? t('sales.templates.days', { count: chosen.value.validity_days }, chosen.value.validity_days) : t('sales.templates.settingsValidity') })
  : t('sales.templates.picker.hint'))
</script>

<template>
  <UFormField v-if="hasTemplates || modelValue" :label="t('sales.templates.picker.label')" name="sales-template" :help="hint" :error="props.error">
    <USelectMenu :model-value="props.modelValue ?? NONE" v-model:search-term="search" value-key="value" :items="items" ignore-filter :search-input="{ placeholder: t('sales.templates.search') }" :loading="query.isFetching.value" class="w-full" :disabled="props.disabled || !hydrated" :aria-label="t('sales.templates.picker.label')" data-testid="sales-template-pick" @update:model-value="choose" />
  </UFormField>
</template>
