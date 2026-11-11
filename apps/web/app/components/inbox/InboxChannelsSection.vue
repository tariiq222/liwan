<script setup lang="ts">
import InboxTikTokConnect from '@/components/inbox/InboxTikTokConnect.vue'
import { CHANNEL_KIND_ICON, channelKindLabelKey } from '@/composables/inbox/inboxChannelKind'
import { useInboxFlowsEnabled, useInboxTemplatesEnabled, useInboxWhatsAppEnabled } from '@/composables/inbox/inboxFeatures'
import { CHANNEL_STATE_TONE } from '@/composables/inbox/inboxPresentation'
import { inboxTikTokReasonKey, useInboxTikTokEnabled } from '@/composables/inbox/inboxTikTok'
import { useInboxChannels, useInboxChannelWork } from '@/composables/inbox/useInboxSettings'

// The connected channels, one row each by kind: a WhatsApp number or a TikTok account. A channel opens its own page
// (status, webhook details, secrets); connecting a WhatsApp number is the route-backed create panel at
// /settings/apps/inbox/channels/new, and connecting TikTok is this card's inline form. A callback that could not
// connect returns to this page as ?tiktok_error=<reason> and is explained here, in place.
// A templates, forms or automation manager has no channel administration: the same card gives them the channels they
// may work on and the entry to their own section, never the channel page, its secrets or its connect buttons.
const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('inbox.channels.manage'))
const whatsappOn = useInboxWhatsAppEnabled()
const tiktokOn = useInboxTikTokEnabled()
const templatesOn = useInboxTemplatesEnabled()
const flowsOn = useInboxFlowsEnabled()
const admin = useInboxChannels(computed(() => canManage.value))
const work = useInboxChannelWork(computed(() => !canManage.value))
// A reference row is offered only when the viewer can do one of its actions; a templates manager never sees a TikTok
// row it cannot open, and automation alone opens both kinds.
const workable = (channel: { kind: string }) => can('inbox.automation.manage')
  || (channel.kind === 'whatsapp' && ((templatesOn.value && can('inbox.templates.manage')) || (flowsOn.value && can('inbox.flows.manage'))))
const adminRows = computed(() => (canManage.value ? admin.data.value?.items ?? [] : []))
const workRows = computed(() => (canManage.value ? [] : (work.data.value?.items ?? []).filter(workable)))
const hasRows = computed(() => adminRows.value.length > 0 || workRows.value.length > 0)
const isLoading = computed(() => (canManage.value ? admin.isLoading.value : work.isLoading.value))
const error = computed(() => (canManage.value ? admin.error.value : work.error.value))
const refetch = () => (canManage.value ? admin.refetch() : work.refetch())
const tiktokErrorKey = computed(() => inboxTikTokReasonKey(route.query.tiktok_error))
</script>

<template>
  <SharedRecordSection id="channels" variant="list" class="liwan-settings-anchor" :title="t('inbox.settings.channels.title')" :description="canManage ? t('inbox.settings.channels.hint') : t('inbox.settings.channels.workHint')">
    <template #actions>
      <UButton v-if="canManage && whatsappOn" to="/settings/apps/inbox/channels/new" icon="i-lucide-plus" :disabled="!hydrated" :label="t('inbox.settings.channels.connect')" data-testid="inbox-channel-connect" />
    </template>
    <div v-if="canManage && (tiktokOn || tiktokErrorKey)" class="border-b border-default px-(--liwan-card-pad)">
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
    <p v-else-if="!hasRows" class="px-(--liwan-card-pad) py-4 text-sm text-muted">{{ canManage ? t('inbox.settings.channels.empty') : t('inbox.settings.channels.workEmpty') }}</p>
    <template v-else>
      <NuxtLink
        v-for="channel in adminRows"
        :key="`admin-${channel.id}`"
        :to="`/settings/apps/inbox/channels/${channel.id}`"
        class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3 text-start transition-colors hover:bg-(--liwan-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
        :data-testid="`inbox-channel-${channel.id}`"
      >
        <span class="flex min-w-0 items-center gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary"><UIcon :name="CHANNEL_KIND_ICON[channel.kind]" class="size-5" aria-hidden="true" /></span>
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
      <div v-for="channel in workRows" :key="`work-${channel.id}`" class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3" :data-testid="`inbox-work-channel-${channel.id}`">
        <span class="flex min-w-0 items-center gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary"><UIcon :name="CHANNEL_KIND_ICON[channel.kind]" class="size-5" aria-hidden="true" /></span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-highlighted">{{ channel.name }}</span>
            <span class="block truncate text-xs text-muted">
              {{ t(channelKindLabelKey(channel.kind)) }}<template v-if="channel.department"> · {{ channel.department.name }}</template>
            </span>
          </span>
        </span>
        <span class="flex flex-wrap items-center gap-2">
          <UButton v-if="channel.kind === 'whatsapp' && templatesOn && can('inbox.templates.manage')" size="sm" color="neutral" variant="outline" icon="i-lucide-file-text" :to="`/settings/apps/inbox/channels/${channel.id}/templates`" :label="t('inbox.templates.title')" :data-testid="`inbox-work-templates-${channel.id}`" />
          <UButton v-if="channel.kind === 'whatsapp' && flowsOn && can('inbox.flows.manage')" size="sm" color="neutral" variant="outline" icon="i-lucide-clipboard-list" :to="`/settings/apps/inbox/channels/${channel.id}/flows`" :label="t('inbox.flows.title')" :data-testid="`inbox-work-flows-${channel.id}`" />
          <UButton v-if="can('inbox.automation.manage')" size="sm" color="neutral" variant="outline" icon="i-lucide-bot-message-square" :to="`/settings/apps/inbox/auto-messages/${channel.id}`" :label="t('inbox.automation.messages.title')" :data-testid="`inbox-work-automation-${channel.id}`" />
        </span>
      </div>
    </template>
  </SharedRecordSection>
</template>
