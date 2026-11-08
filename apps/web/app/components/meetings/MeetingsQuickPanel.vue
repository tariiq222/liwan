<script setup lang="ts">
import { useMeetings } from '@/composables/useMeetings'
import { formatDate, formatTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'

// The meetings manifest's top-bar panel (AppManifest.quickPanel): my confirmed meetings from today on.
const PANEL_ROWS = 6
const { t } = useI18n()
const { me } = useMe()
const { data, isLoading, error, refetch } = useMeetings({ mine: true, state: 'confirmed', date_from: localIsoDay(new Date()), limit: PANEL_ROWS })
const rows = computed(() => (data.value?.items ?? []).slice(0, PANEL_ROWS))
const caption = (start: string | null) => start ? `${formatDate(start, me.value?.tz)} ${formatTime(start, me.value?.tz)}` : undefined
</script>

<template>
  <div data-testid="meetings-quick-panel">
    <ShellPanelStatus v-if="error" kind="error" :message="t('nav.panel.error')" :retry-label="t('nav.panel.retry')" @retry="refetch()" />
    <ShellPanelStatus v-else-if="isLoading" kind="loading" :message="t('nav.panel.loading')" />
    <ShellPanelStatus v-else-if="!rows.length" kind="empty" :message="t('nav.panel.meetingsEmpty')" />
    <template v-else>
      <ShellPanelRow v-for="meeting in rows" :key="meeting.id" :to="`/meetings/${meeting.id}`" :lead="Array.from(meeting.name)[0] ?? '?'" :title="meeting.name" :caption="caption(meeting.start_datetime)" :test-id="`meetings-quick-${meeting.id}`" />
    </template>
  </div>
</template>
