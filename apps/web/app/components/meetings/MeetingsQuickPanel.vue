<script setup lang="ts">
import { useMeetings } from '@/composables/useMeetings'
import { formatDate, formatTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'

// The meetings manifest's top-bar panel (AppManifest.quickPanel): my next confirmed meetings. The list API returns the latest first
// and a limit would keep the farthest ones, so the panel asks for the next 90 days (a range lifts the row cap), sorts them
// nearest first and shows the first rows.
const PANEL_ROWS = 6
const WINDOW_DAYS = 90
const { t } = useI18n()
const { me } = useMe()
const { data, isLoading, error, refetch } = useMeetings({ mine: true, state: 'confirmed', date_from: localIsoDay(new Date()), date_to: localIsoDay(new Date(Date.now() + WINDOW_DAYS * 86_400_000)) })
const rows = computed(() => [...(data.value?.items ?? [])]
  .sort((a, b) => (a.start_datetime ?? a.meeting_date ?? '').localeCompare(b.start_datetime ?? b.meeting_date ?? ''))
  .slice(0, PANEL_ROWS))
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
