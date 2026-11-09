<script setup lang="ts">
import { useMyTaskList } from '@/composables/useMyTaskList'
import { formatDate, formatTime } from '@liwan/ui/app/utils/formatDate'

// The tasks manifest's top-bar panel (AppManifest.quickPanel): my open tasks, the nearest deadline first.
const PANEL_ROWS = 6
const { t } = useI18n()
const { me } = useMe()
const { data, isLoading, error, refetch } = useMyTaskList({ closed: false, scope: 'assigned', sort: 'deadline' })
const rows = computed(() => (data.value?.items ?? []).slice(0, PANEL_ROWS))
const caption = (deadline: string | null) => deadline ? `${formatDate(deadline, me.value?.tz)} ${formatTime(deadline, me.value?.tz)}` : t('nav.panel.noDeadline')
</script>

<template>
  <div data-testid="tasks-quick-panel">
    <ShellPanelStatus v-if="error" kind="error" :message="t('nav.panel.error')" :retry-label="t('nav.panel.retry')" @retry="refetch()" />
    <ShellPanelStatus v-else-if="isLoading" kind="loading" :message="t('nav.panel.loading')" />
    <ShellPanelStatus v-else-if="!rows.length" kind="empty" :message="t('nav.panel.tasksEmpty')" />
    <template v-else>
      <ShellPanelRow v-for="task in rows" :key="task.id" :to="task.href" check :title="task.name" :caption="caption(task.date_deadline)" :test-id="`tasks-quick-${task.id}`" />
    </template>
  </div>
</template>
