<script setup lang="ts">
import type { InboxCampaign } from '@liwan/contracts'
import { campaignTiles, dispatchedPercent } from '@/composables/inbox/inboxCampaignPresentation'

// The live numbers of one campaign: why it is paused or waiting (with Meta's own words), the figures of its recipients and
// how far the sending has got. The page refetches the campaign every 10 seconds while it runs.
const props = defineProps<{ campaign: InboxCampaign; loading?: boolean }>()
const { t, locale } = useI18n()
const tiles = computed(() => campaignTiles(props.campaign.stats, t, locale.value))
const sent = computed(() => dispatchedPercent(props.campaign.stats))
const waiting = computed(() => props.campaign.waiting && (props.campaign.state === 'running' || props.campaign.state === 'scheduled') ? props.campaign.waiting : null)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-(--liwan-gap-card)" data-testid="inbox-campaign-stats">
    <UAlert
      v-if="props.campaign.state === 'paused' && props.campaign.pause_reason" role="alert" color="warning" variant="subtle" icon="i-lucide-pause-circle"
      :title="t(`inbox.campaigns.pause.${props.campaign.pause_reason}`)" :description="props.campaign.pause_detail ?? t(`inbox.campaigns.pauseHint.${props.campaign.pause_reason}`)" data-testid="inbox-campaign-paused"
    />
    <UAlert v-else-if="waiting" role="status" color="info" variant="subtle" icon="i-lucide-clock" :title="t(`inbox.campaigns.waiting.${waiting}`)" data-testid="inbox-campaign-waiting" />
    <SharedKpiStrip :tiles="tiles" :loading="props.loading" :skeleton-count="7" :label="t('inbox.campaigns.stats.label')" />
    <SharedRecordSection v-if="sent !== null" variant="panel" :title="t('inbox.campaigns.stats.progress')">
      <div class="flex items-center gap-3">
        <SharedProgress class="flex-1" size="md" :value="sent" :label="t('inbox.campaigns.stats.progress')" />
        <span class="text-sm tabular-nums text-muted" data-testid="inbox-campaign-progress">{{ sent }}%</span>
      </div>
    </SharedRecordSection>
  </div>
</template>
