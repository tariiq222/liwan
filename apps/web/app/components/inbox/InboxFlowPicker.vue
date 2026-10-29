<script setup lang="ts">
import { useInboxSendableFlows } from '@/composables/inbox/useInboxFlows'

// Picks one form that may be sent now (published, not blocked) from a channel. A form already chosen stays shown even
// when it is no longer on the list (deprecated since), with its name given by the caller, so an old choice is visible
// instead of silently blank.
const flowId = defineModel<number | null>({ required: true })
const props = defineProps<{ channelId: number | null; known?: { id: number; name: string } | null; disabled?: boolean; ariaLabel?: string; invalid?: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const query = useInboxSendableFlows(() => props.channelId)
const items = computed(() => {
  const listed = (query.data.value?.items ?? []).map(flow => ({ value: String(flow.id), label: flow.name }))
  const known = props.known
  return known && !listed.some(item => item.value === String(known.id)) ? [{ value: String(known.id), label: known.name }, ...listed] : listed
})
const empty = computed(() => !!props.channelId && query.isSuccess.value && !items.value.length)
const select = (value: string | number | undefined) => { flowId.value = value === undefined || value === '' ? null : Number(value) }
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="inbox-flow-picker">
    <USelect
      :model-value="flowId === null ? undefined : String(flowId)"
      :items="items"
      class="w-full"
      :placeholder="props.channelId ? t('inbox.flows.picker.placeholder') : t('inbox.flows.picker.needChannel')"
      :aria-label="props.ariaLabel ?? t('inbox.flows.picker.label')"
      :aria-invalid="props.invalid || undefined"
      :loading="query.isFetching.value"
      :disabled="!hydrated || props.disabled || !props.channelId"
      data-testid="inbox-flow-picker-select"
      @update:model-value="select"
    />
    <p v-if="query.isError.value" class="text-xs text-error" role="alert">{{ t('inbox.flows.picker.failed') }}</p>
    <p v-else-if="empty" class="text-xs text-muted" data-testid="inbox-flow-picker-empty">
      {{ t('inbox.flows.picker.empty') }}
      <NuxtLink v-if="can('inbox.flows.manage')" :to="`/settings/apps/inbox/channels/${props.channelId}/flows`" class="text-brand-link underline">{{ t('inbox.flows.picker.manage') }}</NuxtLink>
    </p>
  </div>
</template>
