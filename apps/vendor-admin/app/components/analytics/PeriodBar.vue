<script setup lang="ts">
import { customRangeFits, PERIOD_PRESETS, type PeriodChoice, type PeriodPreset } from '@/utils/vendorAnalytics'

// The period the analytics describe: this month, quarter or year to date, or a custom range.
// The page keeps the choice in the URL; this bar only reports what the owner picked.
const props = defineProps<{ modelValue: PeriodChoice }>()
const emit = defineEmits<{ 'update:modelValue': [value: PeriodChoice] }>()
const { t } = useI18n()
const draft = reactive({ from: props.modelValue.from, to: props.modelValue.to })
watch(() => props.modelValue, value => Object.assign(draft, { from: value.from, to: value.to }))
const customValid = computed(() => Boolean(draft.from && draft.to && draft.from <= draft.to && customRangeFits(draft.from, draft.to)))
const customInvalid = computed(() => props.modelValue.preset === 'custom' && Boolean(draft.from && draft.to) && !customValid.value)
function choose(preset: PeriodPreset) {
  if (preset === 'custom') emit('update:modelValue', { preset, from: draft.from, to: draft.to })
  else emit('update:modelValue', { preset, from: '', to: '' })
}
function applyCustom() {
  if (customValid.value) emit('update:modelValue', { preset: 'custom', from: draft.from, to: draft.to })
}
</script>

<template>
  <div class="flex flex-wrap items-end gap-3" role="group" :aria-label="t('analytics.period.label')" data-testid="analytics-period">
    <div class="flex flex-wrap gap-1">
      <UButton
        v-for="preset in PERIOD_PRESETS" :key="preset" size="sm" :aria-pressed="props.modelValue.preset === preset"
        :variant="props.modelValue.preset === preset ? 'solid' : 'outline'" color="neutral" :data-testid="`analytics-period-${preset}`"
        @click="choose(preset)"
      >
        {{ t(`analytics.period.${preset}`) }}
      </UButton>
    </div>
    <form v-if="props.modelValue.preset === 'custom'" class="flex flex-wrap items-end gap-2" @submit.prevent="applyCustom">
      <UFormField :label="t('analytics.period.from')" :error="customInvalid ? t('analytics.period.invalid') : undefined">
        <UInput v-model="draft.from" type="date" size="sm" data-testid="analytics-period-from" />
      </UFormField>
      <UFormField :label="t('analytics.period.to')">
        <UInput v-model="draft.to" type="date" size="sm" data-testid="analytics-period-to" />
      </UFormField>
      <UButton type="submit" size="sm" :disabled="!customValid" data-testid="analytics-period-apply">{{ t('analytics.period.apply') }}</UButton>
    </form>
  </div>
</template>
