<script setup lang="ts">
import type { InboxChannelAlert } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'
import { INBOX_ALERT_PAGE, useInboxChannelAlerts } from '@/composables/inbox/useInboxChannelHealth'

// The alert timeline of one number: what Meta told us about its quality, limit, name and account, newest first, paginated.
const props = defineProps<{ channelId: number }>()
const { t, te } = useI18n()
const hydrated = useHydrated()

type Severity = InboxChannelAlert['severity']
const SEVERITY_TONE: Record<Severity, StatusTone> = { info: 'info', warning: 'warning', danger: 'destructive' }
const SEVERITY_ICON: Record<Severity, string> = { info: 'i-lucide-info', warning: 'i-lucide-triangle-alert', danger: 'i-lucide-octagon-alert' }

const page = ref(1)
const query = useInboxChannelAlerts(() => props.channelId, () => (page.value - 1) * INBOX_ALERT_PAGE)
watch(() => props.channelId, () => { page.value = 1 })
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / INBOX_ALERT_PAGE)))
const rangeLabel = computed(() => t('inbox.health.alerts.range', { from: (page.value - 1) * INBOX_ALERT_PAGE + 1, to: (page.value - 1) * INBOX_ALERT_PAGE + items.value.length, total: total.value }))

const limitLabel = (value: InboxChannelAlert['messaging_limit']) => value ? t(`inbox.health.limit.${value}`) : ''
function text(alert: InboxChannelAlert): string {
  switch (alert.kind) {
    case 'quality_changed': return t('inbox.health.alerts.kind.quality_changed', { quality: alert.quality_rating ? t(`inbox.health.quality.${alert.quality_rating}`) : '' })
    case 'messaging_limit_changed':
      return alert.previous_messaging_limit
        ? t('inbox.health.alerts.kind.messaging_limit_changed_from', { previous: limitLabel(alert.previous_messaging_limit), limit: limitLabel(alert.messaging_limit) })
        : t('inbox.health.alerts.kind.messaging_limit_changed', { limit: limitLabel(alert.messaging_limit) })
    case 'name_rejected':
    case 'name_pending': return t(`inbox.health.alerts.kind.${alert.kind}`, { name: alert.requested_name ?? '' })
    default: return t(`inbox.health.alerts.kind.${alert.kind}`)
  }
}
const reasonText = (reason: string) => te(`inbox.health.nameReasons.${reason}`) ? t(`inbox.health.nameReasons.${reason}`) : reason
</script>

<template>
  <SharedRecordSection variant="list" :title="t('inbox.health.alerts.title')" :description="t('inbox.health.alerts.description')" data-testid="inbox-health-alerts">
    <SharedPageState v-if="query.error.value" class="m-4" :error="query.error.value" @retry="query.refetch()" />
    <SharedLoadingSkeleton v-else-if="query.isPending.value" class="m-4" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted" data-testid="inbox-health-alerts-empty">{{ t('inbox.health.alerts.empty') }}</p>
    <ol v-else :aria-label="t('inbox.health.alerts.caption')" class="divide-y divide-default">
      <li v-for="alert in items" :key="alert.id" class="flex items-start gap-3 px-(--webvue-card-pad) py-3" :data-testid="`inbox-health-alert-${alert.id}`" :data-severity="alert.severity">
        <UIcon :name="SEVERITY_ICON[alert.severity]" class="mt-0.5 size-5 shrink-0" :class="{ 'text-info': alert.severity === 'info', 'text-warning': alert.severity === 'warning', 'text-error': alert.severity === 'danger' }" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-medium text-highlighted">{{ text(alert) }}</span>
            <span class="flex items-center gap-2">
              <SharedStatusBadge size="sm" :tone="SEVERITY_TONE[alert.severity]" :label="t(`inbox.health.alerts.severity.${alert.severity}`)" />
              <time class="text-xs text-muted" :datetime="alert.occurred_at">{{ formatDateTime(alert.occurred_at) }}</time>
            </span>
          </div>
          <p v-if="alert.reason" class="text-xs text-muted">{{ t('inbox.health.alerts.reason') }}: <bdi dir="auto">{{ reasonText(alert.reason) }}</bdi></p>
          <p v-if="alert.expires_at" class="text-xs text-muted">{{ t('inbox.health.alerts.expires', { time: formatDateTime(alert.expires_at) }) }}</p>
        </div>
      </li>
    </ol>
    <div v-if="total > INBOX_ALERT_PAGE" class="flex px-(--webvue-card-pad) py-3 text-sm text-muted">
      <SharedListFooter :count-label="rangeLabel" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="page = $event" />
    </div>
  </SharedRecordSection>
</template>
