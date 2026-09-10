<script setup lang="ts">
import type { PreviewRecord } from '../composables/usePreview'
defineProps<{ record: PreviewRecord }>()
const { t, statusColor } = usePreview()
</script>
<template>
  <div class="space-y-6">
    <UCard>
      <template #header><h2 class="preview-section-title">{{ t('basic') }}</h2></template>
      <dl class="grid sm:grid-cols-2 gap-6">
        <div><dt class="text-muted text-sm">{{ t('number') }}</dt><dd class="mt-2 font-medium"><bdi>{{ record.id }}</bdi></dd></div>
        <div><dt class="text-muted text-sm">{{ t('owner') }}</dt><dd class="mt-2 font-medium">{{ t(`people.${record.owner}`) }}</dd></div>
        <div><dt class="text-muted text-sm">{{ t('due') }}</dt><dd class="mt-2 font-medium"><bdi>{{ record.due || '—' }}</bdi></dd></div>
        <div><dt class="text-muted text-sm">{{ t('status') }}</dt><dd class="mt-2"><UBadge :color="statusColor(record.state)" variant="subtle">{{ t(record.state) }}</UBadge></dd></div>
      </dl>
    </UCard>
    <section class="space-y-3"><h2 class="preview-section-title">{{ t('description') }}</h2><p class="leading-loose text-toned whitespace-pre-wrap">{{ record.description || t('samples.description') }}</p></section>
    <section class="space-y-3"><div class="flex justify-between"><h2 class="preview-section-title">{{ t('progress') }}</h2><span class="font-medium"><bdi>{{ record.progress }}%</bdi></span></div><PreviewProgress :value="record.progress" :label="t('progress')" /></section>
  </div>
</template>
