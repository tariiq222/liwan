<script setup lang="ts">
import type { InboxChannelWork } from '@liwan/contracts'
import { CHANNEL_KIND_ICON } from '@/composables/inbox/inboxChannelKind'
import { useInboxChannels, useInboxChannelWork } from '@/composables/inbox/useInboxSettings'

// The way in to the templates or the forms of the company: both belong to a WhatsApp channel, so this page lists the
// WhatsApp channels the viewer may work on and opens the section of the one chosen. A single WhatsApp channel has nothing
// to choose, so its section opens at once. A channels manager reads the full list; a templates or forms manager the
// reference list, as in the channels card.
const props = defineProps<{ section: 'templates' | 'flows' }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canAdmin = computed(() => can('inbox.channels.manage'))
const allowed = computed(() => canAdmin.value || can(`inbox.${props.section}.manage`))
const admin = useInboxChannels(computed(() => allowed.value && canAdmin.value))
const work = useInboxChannelWork(computed(() => allowed.value && !canAdmin.value))
const source = computed(() => (canAdmin.value ? admin : work))
const channels = computed<InboxChannelWork[]>(() => (source.value.data.value?.items ?? []).filter(channel => channel.kind === 'whatsapp'))
const sectionPath = (id: number) => `/settings/apps/inbox/channels/${id}/${props.section}`
const settled = computed(() => allowed.value && !source.value.isLoading.value && !source.value.error.value)
watch([settled, channels], () => {
  const [only] = channels.value
  if (settled.value && channels.value.length === 1 && only) navigateTo(sectionPath(only.id), { replace: true })
}, { immediate: true })
</script>

<template>
  <SharedForbiddenState v-if="!allowed" />
  <SharedLoadingSkeleton v-else-if="source.isLoading.value || (settled && channels.length === 1)" />
  <SharedPageState v-else-if="source.error.value" :error="source.error.value" @retry="source.refetch()" />
  <SharedEmptyState v-else-if="!channels.length" icon="i-lucide-plug-zap" bordered :title="t('inbox.settings.channels.pickEmpty')" :description="t('inbox.settings.channels.pickEmptyDescription')" data-testid="inbox-channel-picker-empty">
    <template v-if="canAdmin" #action><UButton to="/settings/apps/inbox/channels/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.settings.channels.connect')" data-testid="inbox-channel-picker-connect" /></template>
  </SharedEmptyState>
  <SharedRecordSection v-else variant="list" :description="props.section === 'templates' ? t('inbox.settings.channels.pickTemplatesHint') : t('inbox.settings.channels.pickFlowsHint')">
    <NuxtLink
      v-for="channel in channels"
      :key="channel.id"
      :to="sectionPath(channel.id)"
      class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3 text-start transition-colors hover:bg-(--liwan-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
      :data-testid="`inbox-channel-picker-${channel.id}`"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary"><UIcon :name="CHANNEL_KIND_ICON[channel.kind]" class="size-5" aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ channel.name }}</span>
          <span v-if="channel.department" class="block truncate text-xs text-muted">{{ channel.department.name }}</span>
        </span>
      </span>
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
    </NuxtLink>
  </SharedRecordSection>
</template>
