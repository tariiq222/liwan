<script setup lang="ts">
import { VisSingleContainer, VisDonut } from '@unovis/vue'
defineProps<{ data: { value: number; label: string }[]; total: number }>()
const { t } = usePreview()
const colors = ['var(--primary)', 'var(--secondary)', 'var(--ui-text-muted)']
</script>
<template>
  <div class="preview-chart" role="img" :aria-label="t('chartAlt')">
    <VisSingleContainer :data="data" :height="220">
      <VisDonut :value="(item: { value: number }) => item.value" :color="(_: unknown, index: number) => colors[index % colors.length]!" :arc-width="26" :central-label="String(total)" :duration="0" />
    </VisSingleContainer>
  </div>
</template>
