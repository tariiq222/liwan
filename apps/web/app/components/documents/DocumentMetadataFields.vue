<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { DocumentContext, DocumentTag } from '@webvue/contracts'
import { documentLookupItems } from '@/lib/documentLookup'
import DocumentContextField from './DocumentContextField.vue'
import { useDocumentTags, useCreateDocumentTag } from '@/composables/useDocuments'
const expiry = defineModel<string | null>('expiry', { required: true })
const context = defineModel<{ kind: string; id: number } | null>('context', { required: true })
const tags = defineModel<number[]>('tags', { required: true })
const props = defineProps<{ disabled?: boolean; knownTags?: DocumentTag[]; knownContext?: DocumentContext | null }>()
const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const { me } = useMe()
const search = ref(''); const debounced = refDebounced(search, 250); const offset = ref(0); const limit = 50
watch([debounced, () => me.value?.company.id], () => { offset.value = 0 }, { flush: 'sync' })
const tagQuery = useDocumentTags(computed(() => ({ q: debounced.value.trim(), limit, offset: offset.value })))
const picked = ref<DocumentTag[]>([])
watch(() => me.value?.company.id, () => { picked.value = []; search.value = '' }, { flush: 'sync' })
const tagItems = computed(() => documentLookupItems(tags.value, [...(props.knownTags ?? []), ...picked.value], tagQuery.data.value?.items ?? []))
const pages = computed(() => Math.max(1, Math.ceil((tagQuery.data.value?.total ?? 0) / limit)))
function selectTags(value: number[]) {
  if (!hydrated.value || props.disabled) return
  const names = new Map([...(props.knownTags ?? []), ...picked.value, ...(tagQuery.data.value?.items ?? [])].map(item => [item.id, item]))
  picked.value = value.map(id => names.get(id)).filter((item): item is DocumentTag => !!item)
  tags.value = value
}
const tagName = ref(''); const error = ref(''); const createTag = useCreateDocumentTag()
async function addTag() {
  if (props.disabled || !tagName.value.trim() || !hydrated.value || createTag.isPending.value) return
  try { const tag = await createTag.mutateAsync(tagName.value.trim()); picked.value = [...picked.value.filter(item => item.id !== tag.id), tag]; tags.value = [...new Set([...tags.value, tag.id])]; tagName.value = ''; error.value = '' }
  catch { error.value = t('errors.generic') }
}
</script>
<template>
  <UFormField :label="t('documents.expiry')" name="document-expiry"><SharedDateField id="document-expiry" v-model="expiry" :aria-label="t('documents.expiry')" class="w-full" :disabled="disabled || !hydrated" /></UFormField>
  <DocumentContextField v-model="context" :known="knownContext" :disabled="disabled" />
  <UFormField :label="t('documents.tags')" name="document-tags">
    <USelectMenu id="document-tags" :model-value="tags" v-model:search-term="search" multiple value-key="value" :items="tagItems" ignore-filter :aria-label="t('documents.tags')" :search-input="{ placeholder: t('documents.tags') }" :loading="tagQuery.isFetching.value" @update:model-value="selectTags" :disabled="disabled || !hydrated" class="w-full" />
    <UAlert v-if="tagQuery.error.value" class="mt-2" color="error" :title="t('errors.generic')"><template #actions><UButton type="button" :label="t('documents.reload')" @click="tagQuery.refetch()" /></template></UAlert>
    <SharedPagination class="mt-2" :page="Math.floor(offset / limit) + 1" :pages="pages" :disabled="disabled || tagQuery.isFetching.value" @update:page="offset = ($event - 1) * limit" />
  </UFormField>
  <div v-if="can('documents.library.manage')" class="flex flex-wrap items-end gap-2">
    <UFormField :label="t('documents.newTag')" name="document-new-tag" class="flex-1"><UInput id="document-new-tag" v-model="tagName" class="w-full" :disabled="disabled || !hydrated || createTag.isPending.value" /></UFormField>
    <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('documents.addTag')" :disabled="disabled || !hydrated || !tagName.trim()" :loading="createTag.isPending.value" @click="addTag" />
    <UAlert v-if="error" color="error" :title="error" class="w-full" />
  </div>
</template>
