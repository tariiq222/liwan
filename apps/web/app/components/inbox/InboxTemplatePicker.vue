<script setup lang="ts">
import type { InboxTemplate } from '@liwan/contracts'
import { refDebounced } from '@vueuse/core'
import { useInboxChannelTemplates, useInboxTemplate } from '@/composables/inbox/useInboxSettings'

// Picks one approved template of a channel. The server returns one page of matches for the typed name (`q`, debounced),
// so a channel with hundreds of templates stays reachable by search. The chosen template is read by id, so it stays shown
// (and handed to the caller as `template`) after the search narrows the list past it. `accept` is a client-side filter on
// the page the server returned; the server filters only by status, category and name, so when more matches exist than the
// page holds the picker says so instead of looking complete. The caller supplies the text for "no template at all".
// Attributes (the test id, an id for a label) go to the select itself, not to the wrapper.
defineOptions({ inheritAttrs: false })
const TEMPLATE_PAGE = 50
const templateId = defineModel<number | null>({ required: true })
const template = defineModel<InboxTemplate | null>('template', { default: null })
const props = defineProps<{ channelId: number | null; accept?: (template: InboxTemplate) => boolean; disabled?: boolean; invalid?: boolean }>()
const { t } = useI18n()
const search = ref('')
const debounced = refDebounced(search, 250)
const query = useInboxChannelTemplates(() => props.channelId, computed(() => ({ status: 'approved', q: debounced.value.trim(), limit: TEMPLATE_PAGE })))
const own = useInboxTemplate(templateId)
const accepted = (item: InboxTemplate) => props.accept?.(item) ?? true
const listed = computed(() => (query.data.value?.items ?? []).filter(accepted))
const more = computed(() => (query.data.value?.total ?? 0) > (query.data.value?.items.length ?? 0))
const selected = computed(() => {
  const id = templateId.value
  if (!id) return null
  const found = listed.value.find(item => item.id === id) ?? (own.data.value?.id === id ? own.data.value : null)
  return found && accepted(found) ? found : null
})
watch(selected, (value) => { template.value = value }, { immediate: true })
const items = computed(() => {
  const list = selected.value && !listed.value.some(item => item.id === selected.value!.id) ? [selected.value, ...listed.value] : listed.value
  return list.map(item => ({ value: item.id, label: `${item.name} · ${item.language} · ${t(`inbox.templates.category.${item.category}`)}` }))
})
const empty = computed(() => query.isSuccess.value && !listed.value.length && !more.value && !debounced.value.trim())
const select = (value: number | undefined) => { templateId.value = value ?? null }
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="inbox-template-picker">
    <USelectMenu
      v-model:search-term="search"
      ignore-filter
      value-key="value"
      :model-value="templateId ?? undefined"
      :items="items"
      class="w-full"
      :placeholder="t('inbox.templates.picker.placeholder')"
      :aria-invalid="props.invalid || undefined"
      :loading="query.isFetching.value"
      :disabled="props.disabled || !props.channelId"
      v-bind="$attrs"
      :search-input="{ placeholder: t('inbox.templates.picker.search'), icon: 'i-lucide-search' }"
      @update:model-value="select"
    >
      <template v-if="more" #content-bottom>
        <p class="border-t border-default px-3 py-2 text-xs text-muted" data-testid="inbox-template-picker-more">{{ t('inbox.templates.picker.more') }}</p>
      </template>
    </USelectMenu>
    <UAlert v-if="query.isError.value" role="alert" color="error" variant="subtle" :title="t('inbox.templates.picker.failed')">
      <template #actions><UButton type="button" color="neutral" variant="outline" :label="t('app.retry')" @click="query.refetch()" /></template>
    </UAlert>
    <p v-else-if="more && !items.length" class="text-xs text-muted" data-testid="inbox-template-picker-refine">{{ t('inbox.templates.picker.more') }}</p>
    <slot v-else-if="empty" name="empty" />
  </div>
</template>
