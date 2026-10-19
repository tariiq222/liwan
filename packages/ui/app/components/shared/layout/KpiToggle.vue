<script setup lang="ts">
// The one show/hide control for the page's KPI strip, drawn by SharedPageHeader (`kpi-toggle`) before the actions.
// A round ghost icon button: the eye-off icon while the figures are shown (press to hide), the chart icon while hidden.
const { t } = useI18n()
const hydrated = useHydrated()
const { shown, toggle } = useKpiVisibility()
const label = computed(() => shown.value ? t('app.hideKpis') : t('app.showKpis'))
</script>

<template>
  <UTooltip :text="label">
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="sm"
      class="rounded-full"
      data-testid="kpi-toggle"
      :icon="shown ? 'i-lucide-eye-off' : 'i-lucide-chart-no-axes-column'"
      :aria-pressed="!shown"
      :aria-label="label"
      :disabled="!hydrated"
      @click="toggle"
    />
  </UTooltip>
</template>
