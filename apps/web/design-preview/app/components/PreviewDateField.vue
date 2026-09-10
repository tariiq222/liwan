<script setup lang="ts">
import { formatCalendarDate, toCalendarDate } from '#nasq-composables/calendarDate'
const props = defineProps<{ label: string; disabled?: boolean }>()
const model = defineModel<string>({ required: true })
const { t, locale } = usePreview()
const open = ref(false)
const date = computed({
  get: () => toCalendarDate(model.value),
  set: (value: ReturnType<typeof toCalendarDate> | null) => {
    model.value = value?.toString() || ''
    open.value = false
  },
})
const text = computed(() => formatCalendarDate(model.value, locale.value) || t('chooseDate'))
</script>
<template>
  <UPopover v-model:open="open">
    <UButton type="button" color="neutral" variant="outline" class="preview-field preview-date-trigger" icon="i-lucide-calendar-days" :label="text" :aria-label="`${props.label}: ${text}`" :disabled="disabled" />
    <template #content>
      <UCalendar v-model="date" class="p-2" :disabled="disabled" />
      <div v-if="model" class="flex justify-end p-2">
        <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('clearDate')" :title="t('clearDate')" :disabled="disabled" @click="date = undefined" />
      </div>
    </template>
  </UPopover>
</template>
