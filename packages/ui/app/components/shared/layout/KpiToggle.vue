<script setup lang="ts">
// The one show/hide control for the page's KPI strip, drawn by SharedPageHeader (`kpi-toggle`) before the actions.
// A 42px icon button like the shell's other icon buttons (12px radius, soft fill, 1.5px border) that lines up with the primary
// button; it reads as pressed while the figures are shown. The accessible name is fixed and `aria-pressed` carries the state,
// so a screen reader never hears it twice; the tooltip says what a press does.
const { t } = useI18n()
const hydrated = useHydrated()
const { shown, toggle } = useKpiVisibility()
const tooltip = computed(() => shown.value ? t('app.hideKpis') : t('app.showKpis'))
</script>

<template>
  <UTooltip :text="tooltip">
    <UButton
      type="button"
      color="neutral"
      variant="soft"
      square
      icon="i-lucide-chart-no-axes-column"
      data-testid="kpi-toggle"
      class="size-(--liwan-control-h) border-[1.5px] border-default pointer-coarse:size-11 aria-pressed:bg-accented aria-pressed:text-highlighted"
      :aria-pressed="shown"
      :aria-label="t('app.toggleKpis')"
      :disabled="!hydrated"
      @click="toggle"
    />
  </UTooltip>
</template>
