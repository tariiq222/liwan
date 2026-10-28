<script setup lang="ts">
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'

// The connected channels. A channel opens its own page (status, webhook details, secrets); connecting a new one is the
// route-backed create panel at /settings/apps/inbox/channels/new.
const { t } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, error, refetch } = useInboxChannels()
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedRecordSection id="channels" variant="list" class="webvue-settings-anchor" :title="t('inbox.settings.channels.title')" :description="t('inbox.settings.channels.hint')">
    <template #actions>
      <UButton to="/settings/apps/inbox/channels/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.settings.channels.connect')" data-testid="inbox-channel-connect" />
    </template>
    <SharedLoadingSkeleton v-if="isLoading" class="m-4" />
    <SharedPageState v-else-if="error" class="m-4" :error="error" @retry="refetch()" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted">{{ t('inbox.settings.channels.empty') }}</p>
    <NuxtLink
      v-for="channel in items"
      v-else
      :key="channel.id"
      :to="`/settings/apps/inbox/channels/${channel.id}`"
      class="flex flex-wrap items-center justify-between gap-3 px-(--webvue-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
      :data-testid="`inbox-channel-${channel.id}`"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-message-circle" class="size-5" aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ channel.name }}</span>
          <span class="block truncate text-xs text-muted">{{ t('inbox.settings.channels.whatsapp') }} · <bdi dir="ltr">{{ channel.phone_number_id }}</bdi><template v-if="channel.department"> · {{ channel.department.name }}</template></span>
        </span>
      </span>
      <span class="flex items-center gap-2">
        <SharedStatusBadge :tone="CHANNEL_STATE_TONE[channel.state]" :label="t(`inbox.channelStates.${channel.state}`)" />
        <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
      </span>
    </NuxtLink>
  </SharedRecordSection>
</template>
