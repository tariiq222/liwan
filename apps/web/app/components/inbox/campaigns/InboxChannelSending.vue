<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { useInboxChannelSending, usePatchInboxChannelSending, useRefreshInboxChannelSending } from '@/composables/inbox/useInboxCampaigns'

// How many customers this number may still start a conversation with in the rolling 24 hours (Meta's limit is shared by
// the whole business account), and whether marketing templates go through the Marketing Messages API. On the channel page
// the tier and quality are the tiles above, so only the budget and the API choice are added; a campaign page also shows
// them. Only a channel manager changes the API; whoever runs campaigns may refresh from Meta.
const props = defineProps<{ channelId: number; canEdit: boolean; showHealth?: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxChannelSending(() => props.channelId)
const { mutate: patch, isPending: patching } = usePatchInboxChannelSending(() => props.channelId)
const { mutate: refresh, isPending: refreshing } = useRefreshInboxChannelSending(() => props.channelId)
const sending = query.data
const off = computed(() => !hydrated.value || patching.value || refreshing.value)
const QUALITY_TONE = { green: 'success', yellow: 'warning', red: 'danger', unknown: 'neutral' } as const
const ONBOARDING_TONE = { onboarded: 'success', eligible: 'warning', not_started: 'neutral', unknown: 'neutral' } as const
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function toggle(enabled: boolean) {
  patch({ marketing_api: enabled ? 'marketing_messages' : 'cloud_api' }, { onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }), onError: fail })
}
function runRefresh() {
  refresh(undefined, { onSuccess: () => toast.add({ title: t('inbox.health.refreshed'), color: 'success' }), onError: fail })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.campaigns.sending.title')" :description="t('inbox.campaigns.sending.description')" data-testid="inbox-channel-sending">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :loading="refreshing" :disabled="off" :label="t('inbox.health.refresh')" data-testid="inbox-sending-refresh" @click="runRefresh" />
    </template>
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <div v-else-if="sending" class="flex flex-col gap-4">
      <section class="grid grid-cols-1 gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-3" :aria-label="t('inbox.campaigns.sending.title')">
        <SharedMetricTile v-if="props.showHealth" density="compact" icon="i-lucide-messages-square" :label="t('inbox.health.tiles.limit')" :value="t(`inbox.health.limit.${sending.messaging_limit}`)" :hint="t('inbox.health.tiles.limitHint')" data-testid="inbox-sending-limit" />
        <SharedMetricTile v-if="props.showHealth" density="compact" icon="i-lucide-gauge" :label="t('inbox.health.tiles.quality')" :value="t(`inbox.health.quality.${sending.quality_rating}`)" :tone="QUALITY_TONE[sending.quality_rating]" data-testid="inbox-sending-quality" />
        <SharedMetricTile density="compact" icon="i-lucide-send" :label="t('inbox.campaigns.sending.used')" :value="sending.used_24h" value-dir="ltr" :hint="t('inbox.campaigns.sending.usedHint')" data-testid="inbox-sending-used" />
        <SharedMetricTile
          density="compact" icon="i-lucide-hourglass" :label="t('inbox.campaigns.sending.remaining')" :value="sending.remaining_24h === null ? t('inbox.campaigns.sending.unlimited') : sending.remaining_24h" value-dir="ltr"
          :tone="sending.remaining_24h === 0 ? 'danger' : 'neutral'" data-testid="inbox-sending-remaining"
        />
        <SharedMetricTile density="compact" icon="i-lucide-badge-check" :label="t('inbox.campaigns.sending.onboarding')" :value="t(`inbox.campaigns.sending.onboardingState.${sending.marketing_onboarding}`)" :tone="ONBOARDING_TONE[sending.marketing_onboarding]" data-testid="inbox-sending-onboarding" />
      </section>
      <label v-if="props.canEdit" class="flex items-start gap-3 text-sm">
        <USwitch :model-value="sending.marketing_api === 'marketing_messages'" class="mt-0.5" :disabled="off" data-testid="inbox-sending-mm" @update:model-value="toggle" />
        <span>
          <span class="block font-medium text-highlighted">{{ t('inbox.campaigns.sending.mmApi') }}</span>
          <span class="block text-xs text-muted">{{ t('inbox.campaigns.sending.mmApiHint') }}</span>
          <span v-if="sending.marketing_api === 'marketing_messages' && sending.marketing_onboarding !== 'onboarded'" class="mt-1 block text-xs text-warning" role="status">{{ t('inbox.campaigns.sending.mmNotOnboarded') }}</span>
        </span>
      </label>
      <p v-else class="text-sm text-muted">{{ t('inbox.campaigns.sending.api', { api: t(`inbox.campaigns.sending.apiName.${sending.marketing_api}`) }) }}</p>
      <p class="text-xs text-muted" data-testid="inbox-sending-checked">{{ sending.checked_at ? t('inbox.health.checkedAt', { time: formatDateTime(sending.checked_at) }) : t('inbox.health.neverChecked') }}</p>
    </div>
  </SharedRecordSection>
</template>
