<script setup lang="ts">
import InboxTikTokConnect from '@/components/inbox/InboxTikTokConnect.vue'
import { CHANNEL_KIND_ICON, channelKindLabelKey } from '@/composables/inbox/inboxChannelKind'
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import { inboxTikTokReasonKey, useInboxTikTokEnabled } from '@/composables/inbox/inboxTikTok'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'

// The connected channels, one row each by kind: a WhatsApp number or a TikTok account. A channel opens its own page
// (status, webhook details, secrets); connecting a WhatsApp number is the route-backed create panel at
// /settings/apps/inbox/channels/new, and connecting TikTok is this card's inline form. A callback that could not
// connect returns to this page as ?tiktok_error=<reason> and is explained here, in place.
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const tiktokOn = useInboxTikTokEnabled()
const { data, isLoading, error, refetch } = useInboxChannels()
const items = computed(() => data.value?.items ?? [])
const tiktokErrorKey = computed(() => inboxTikTokReasonKey(route.query.tiktok_error))
</script>

<template>
  <SharedRecordSection id="channels" variant="list" class="liwan-settings-anchor" :title="t('inbox.settings.channels.title')" :description="t('inbox.settings.channels.hint')">
    <template #actions>
      <UButton to="/settings/apps/inbox/channels/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.settings.channels.connect')" data-testid="inbox-channel-connect" />
    </template>
    <div v-if="tiktokOn || tiktokErrorKey" class="border-b border-default px-(--liwan-card-pad)">
      <UAlert
        v-if="tiktokErrorKey"
        class="mt-3"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="t('inbox.settings.channels.tiktokErrorTitle')"
        :description="t(tiktokErrorKey)"
        data-testid="inbox-tiktok-connect-error"
      />
      <InboxTikTokConnect v-if="tiktokOn" />
    </div>
    <SharedLoadingSkeleton v-if="isLoading" class="m-4" />
    <SharedPageState v-else-if="error" class="m-4" :error="error" @retry="refetch()" />
    <p v-else-if="!items.length" class="px-(--liwan-card-pad) py-4 text-sm text-muted">{{ t('inbox.settings.channels.empty') }}</p>
    <NuxtLink
      v-for="channel in items"
      v-else
      :key="channel.id"
      :to="`/settings/apps/inbox/channels/${channel.id}`"
      class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--liwan-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
      :data-testid="`inbox-channel-${channel.id}`"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon :name="CHANNEL_KIND_ICON[channel.kind]" class="size-5" aria-hidden="true" /></span>
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ channel.name }}</span>
          <span class="block truncate text-xs text-muted">
            {{ t(channelKindLabelKey(channel.kind)) }} ·
            <bdi v-if="channel.tiktok_username" dir="ltr">@{{ channel.tiktok_username }}</bdi>
            <bdi v-else-if="channel.phone_number_id" dir="ltr">{{ channel.phone_number_id }}</bdi>
            <template v-if="channel.department"> · {{ channel.department.name }}</template>
          </span>
        </span>
      </span>
      <span class="flex items-center gap-2">
        <SharedStatusBadge :tone="CHANNEL_STATE_TONE[channel.state]" :label="t(`inbox.channelStates.${channel.state}`)" />
        <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
      </span>
    </NuxtLink>
  </SharedRecordSection>
</template>
