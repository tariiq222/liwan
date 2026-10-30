<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { DocumentContext } from '@liwan/contracts'
import { useDocumentContexts, useDocumentContextOptions } from '@/composables/useDocuments'
import { documentLookupItems, type DocumentOption } from '@/lib/documentLookup'
const props = defineProps<{ modelValue: { kind: string; id: number } | null; known?: DocumentContext | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: { kind: string; id: number } | null] }>()
const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const { me } = useMe()
const contexts = useDocumentContexts(computed(() => can('documents.items.manage')))
const kind = ref(props.modelValue?.kind ?? '')
watch(() => props.modelValue?.kind, value => { if (value) kind.value = value })
const available = computed(() => can('documents.items.manage') ? contexts.data.value?.items ?? [] : [])
const selectedKind = computed(() => available.value.some(item => item.kind === kind.value) ? kind.value : null)
const search = ref(''); const debounced = refDebounced(search, 250); const offset = ref(0); const limit = 50
watch([debounced, selectedKind, () => me.value?.company.id], () => { offset.value = 0 }, { flush: 'sync' })
watch([selectedKind, () => me.value?.company.id], () => { search.value = '' })
const options = useDocumentContextOptions(selectedKind, computed(() => ({ q: debounced.value.trim(), limit, offset: offset.value })))
const selected = useDocumentContextOptions(computed(() => props.modelValue?.kind === selectedKind.value ? selectedKind.value : null), computed(() => ({ id: props.modelValue?.id, limit: 1 })))
const picked = ref<DocumentOption[]>([])
watch([selectedKind, () => me.value?.company.id], () => { picked.value = [] }, { flush: 'sync' })
const items = computed(() => documentLookupItems(props.modelValue ? [props.modelValue.id] : [], [...picked.value, ...(selected.data.value?.items ?? []), ...(props.known?.kind === selectedKind.value && props.known.label ? [{ id: props.known.id, name: props.known.label }] : [])], options.data.value?.items ?? []))
const pages = computed(() => Math.max(1, Math.ceil((options.data.value?.total ?? 0) / limit)))
function selectKind(value: unknown) { kind.value = value === 'none' ? '' : String(value); emit('update:modelValue', null) }
function selectOption(value: unknown) {
  const id = Number(value)
  if (selectedKind.value && id > 0 && hydrated.value && !props.disabled) {
    const found = options.data.value?.items.find(item => item.id === id)
    if (found) picked.value = [found]
    emit('update:modelValue', { kind: selectedKind.value, id })
  }
}
</script>
<template>
  <div v-if="available.length" class="grid gap-(--liwan-gap-card) sm:grid-cols-2">
    <UFormField :label="t('documents.context')" name="document-context-kind">
      <USelect id="document-context-kind" :model-value="kind || 'none'" :items="[{ value: 'none', label: t('documents.noContext') }, ...available.map(item => ({ value: item.kind, label: item.label }))]" class="w-full" :disabled="disabled || !hydrated" @update:model-value="selectKind" />
    </UFormField>
    <UFormField v-if="selectedKind" :label="t('documents.contextRecord')" name="document-context-id" :help="selectedKind === 'hr.employee' ? t('documents.employeeContextHelp') : undefined">
      <USelectMenu id="document-context-id" v-model:search-term="search" :model-value="modelValue?.id" :items="items" value-key="value" ignore-filter :aria-label="t('documents.contextRecord')" :search-input="{ placeholder: t('documents.contextRecord') }" :loading="options.isFetching.value || selected.isFetching.value" class="w-full" :disabled="disabled || !hydrated" @update:model-value="selectOption" />
      <UAlert v-if="options.error.value || selected.error.value" class="mt-2" color="error" :title="t('errors.generic')"><template #actions><UButton type="button" :label="t('documents.reload')" @click="options.refetch(); selected.refetch()" /></template></UAlert>
      <SharedPagination class="mt-2" :page="Math.floor(offset / limit) + 1" :pages="pages" :disabled="disabled || options.isFetching.value" @update:page="offset = ($event - 1) * limit" />
    </UFormField>
  </div>
</template>
