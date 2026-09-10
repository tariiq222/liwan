<script setup lang="ts">
const { t } = usePreview()
const toast = useToast()
const text = ref('')
const selected = ref('active')
const checked = ref(true)
const date = ref('2026-09-20')
function interact() { toast.add({ title: t('interaction'), color: 'success' }) }
</script>
<template>
  <div class="grid xl:grid-cols-2 gap-6">
    <UCard>
      <template #header><h2 class="preview-section-title">{{ t('actions') }}</h2></template>
      <div class="flex flex-wrap gap-3"><UButton :label="t('primaryAction')" @click="interact" /><UButton :label="t('secondaryAction')" color="secondary" @click="interact" /><UButton :label="t('disabledAction')" color="neutral" variant="soft" disabled /><UButton :label="t('loading')" loading disabled /></div>
      <div class="flex flex-wrap gap-3 mt-6"><UBadge v-for="status in ['active', 'done', 'waiting']" :key="status" :color="status === 'done' ? 'success' : status === 'active' ? 'info' : 'warning'" variant="subtle">{{ t(status) }}</UBadge></div>
    </UCard>
    <UCard>
      <template #header><h2 class="preview-section-title">{{ t('fields') }}</h2></template>
      <div class="space-y-5"><UFormField :label="t('exampleText')"><UInput v-model="text" class="w-full" /></UFormField><UFormField :label="t('option')"><USelect v-model="selected" :items="['active', 'done', 'waiting'].map(value => ({ value, label: t(value) }))" class="w-full" /></UFormField><UFormField :label="t('due')"><PreviewDateField v-model="date" :label="t('due')" /></UFormField><UCheckbox v-model="checked" :label="t('checked')" /></div>
    </UCard>
    <UCard class="xl:col-span-2">
      <template #header><h2 class="preview-section-title">{{ t('progress') }}</h2></template>
      <div class="space-y-4"><div v-for="value in [0, 25, 68, 100]" :key="value" class="flex items-center gap-2"><PreviewProgress :value="value" :label="t('progress')" /><bdi class="text-xs tabular-nums shrink-0 w-10 text-end">{{ value }}%</bdi></div></div>
    </UCard>
    <UCard class="xl:col-span-2">
      <template #header><h2 class="preview-section-title">{{ t('feedback') }}</h2></template>
      <div class="grid lg:grid-cols-2 gap-4"><UAlert color="success" variant="subtle" icon="i-lucide-circle-check" :title="t('successTitle')" :description="t('successHint')" /><UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="t('warningTitle')" :description="t('successHint')" /><UAlert color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('saveError')" :description="t('saveErrorHint')" /><UAlert color="info" variant="subtle" icon="i-lucide-info" :title="t('readonly')" :description="t('readonlyHint')" /></div>
    </UCard>
  </div>
</template>
