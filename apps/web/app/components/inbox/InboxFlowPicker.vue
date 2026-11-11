<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useInboxFlow, useInboxSendableFlows } from '@/composables/inbox/useInboxFlows'

// Picks one form that may be sent now (published, not blocked) from a channel. The server returns one page of matches
// for the typed name (`q`, debounced); a form already chosen stays shown even when it is no longer on that page or on
// the list at all (deprecated since), named by the caller or read by id, so a choice is never silently blank.
const flowId = defineModel<number | null>({ required: true })
const props = defineProps<{ channelId: number | null; known?: { id: number; name: string } | null; disabled?: boolean; ariaLabel?: string; invalid?: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const search = ref('')
const debounced = refDebounced(search, 250)
const query = useInboxSendableFlows(() => props.channelId, true, debounced)
const chosen = useInboxFlow(flowId)
const more = computed(() => (query.data.value?.total ?? 0) > (query.data.value?.items.length ?? 0))
const items = computed(() => {
  const listed = (query.data.value?.items ?? []).map(flow => ({ value: String(flow.id), label: flow.name }))
  const known = props.known ?? (chosen.data.value && chosen.data.value.id === flowId.value ? chosen.data.value : null)
  return known && !listed.some(item => item.value === String(known.id)) ? [{ value: String(known.id), label: known.name }, ...listed] : listed
})
const empty = computed(() => !!props.channelId && query.isSuccess.value && !items.value.length && !debounced.value.trim())
const select = (value: string | number | undefined) => { flowId.value = value === undefined || value === '' ? null : Number(value) }
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="inbox-flow-picker">
    <USelectMenu
      v-model:search-term="search"
      ignore-filter
      value-key="value"
      :model-value="flowId === null ? undefined : String(flowId)"
      :items="items"
      class="w-full"
      :placeholder="props.channelId ? t('inbox.flows.picker.placeholder') : t('inbox.flows.picker.needChannel')"
      :aria-label="props.ariaLabel ?? t('inbox.flows.picker.label')"
      :aria-invalid="props.invalid || undefined"
      :loading="query.isFetching.value"
      :disabled="!hydrated || props.disabled || !props.channelId"
      data-testid="inbox-flow-picker-select"
      :search-input="{ placeholder: t('inbox.flows.picker.search'), icon: 'i-lucide-search' }"
      @update:model-value="select"
    >
      <template v-if="more" #content-bottom>
        <p class="border-t border-default px-3 py-2 text-xs text-muted" data-testid="inbox-flow-picker-more">{{ t('inbox.flows.picker.more') }}</p>
      </template>
    </USelectMenu>
    <p v-if="query.isError.value" class="text-xs text-error" role="alert">{{ t('inbox.flows.picker.failed') }}</p>
    <p v-else-if="empty" class="text-xs text-muted" data-testid="inbox-flow-picker-empty">
      {{ t('inbox.flows.picker.empty') }}
      <NuxtLink v-if="can('inbox.flows.manage')" :to="`/settings/apps/inbox/channels/${props.channelId}/flows`" class="text-brand-link underline">{{ t('inbox.flows.picker.manage') }}</NuxtLink>
    </p>
  </div>
</template>
