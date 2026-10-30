<script setup lang="ts">
import type { InboxChannelHealth, InboxQualityRating } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'

// Meta's last known view of a WhatsApp number: the account-state banner (only when something is wrong) and the metric
// tiles (quality, messaging limit, throughput, verified name, code verification). It reads nothing and writes nothing.
const props = defineProps<{ health: InboxChannelHealth }>()
const { t, te } = useI18n()

const QUALITY_TONE: Record<InboxQualityRating, 'success' | 'warning' | 'danger' | 'neutral'> = { green: 'success', yellow: 'warning', red: 'danger', unknown: 'neutral' }
const NAME_TONE = { approved: 'success', available_without_review: 'success', pending_review: 'warning', declined: 'danger', expired: 'warning', none: 'neutral', unknown: 'neutral' } as const

const accountBanner = computed(() => props.health.account_state === 'active' ? null : props.health.account_state)
const bannerDescription = computed(() => {
  const state = props.health.account_state
  if (state === 'restricted') {
    return props.health.account_restricted_until
      ? t('inbox.health.account.restrictedUntil', { time: formatDateTime(props.health.account_restricted_until) })
      : t('inbox.health.account.restrictedNoDate')
  }
  return state === 'disabled' ? t('inbox.health.account.disabledHint') : t('inbox.health.account.scheduledHint')
})
const nameHint = computed(() => {
  const { name_status: status, requested_name: requested, name_rejection_reason: reason } = props.health
  const parts = [t(`inbox.health.nameStatus.${status}`)]
  if (requested) parts.push(t('inbox.health.tiles.requested', { name: requested }))
  if (reason) parts.push(te(`inbox.health.nameReasons.${reason}`) ? t(`inbox.health.nameReasons.${reason}`) : reason)
  return parts.join(' · ')
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-(--liwan-gap-card)" data-testid="inbox-health-card">
    <SharedRecordSection v-if="accountBanner" variant="action" :title="t(`inbox.health.account.${accountBanner}`)" :description="bannerDescription" data-testid="inbox-health-banner" :data-state="accountBanner" />
    <section class="grid grid-cols-1 gap-(--liwan-gap-card) sm:grid-cols-2 xl:grid-cols-3" :aria-label="t('inbox.health.tilesLabel')">
      <SharedMetricTile
        density="compact" icon="i-lucide-gauge" :label="t('inbox.health.tiles.quality')" :value="t(`inbox.health.quality.${health.quality_rating}`)"
        :tone="QUALITY_TONE[health.quality_rating]" data-testid="inbox-health-quality"
      />
      <SharedMetricTile
        density="compact" icon="i-lucide-messages-square" :label="t('inbox.health.tiles.limit')" :value="t(`inbox.health.limit.${health.messaging_limit}`)"
        :hint="t('inbox.health.tiles.limitHint')" data-testid="inbox-health-limit"
      />
      <SharedMetricTile
        density="compact" icon="i-lucide-zap" :label="t('inbox.health.tiles.throughput')" :value="t(`inbox.health.throughput.${health.throughput_level}`)"
        data-testid="inbox-health-throughput"
      />
      <SharedMetricTile
        density="compact" icon="i-lucide-badge-check" :label="t('inbox.health.tiles.name')" :value="health.verified_name ?? t('inbox.health.tiles.noName')"
        :hint="nameHint" :tone="NAME_TONE[health.name_status]" data-testid="inbox-health-name"
      />
      <SharedMetricTile
        density="compact" icon="i-lucide-shield-check" :label="t('inbox.health.tiles.code')" :value="health.code_verified ? t('inbox.health.tiles.verified') : t('inbox.health.tiles.unverified')"
        :tone="health.code_verified ? 'success' : 'warning'" data-testid="inbox-health-code"
      />
      <SharedMetricTile
        density="compact" icon="i-lucide-phone" :label="t('inbox.health.tiles.number')" :value="health.display_phone_number ? `+${health.display_phone_number}` : null"
        value-dir="ltr" data-testid="inbox-health-number"
      />
    </section>
  </div>
</template>
