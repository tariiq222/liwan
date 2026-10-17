<script setup lang="ts">
import type { ListViewOption } from '../../../utils/listView'

// The list / board switch (Tasmim spec §6). SharedListPage binds it to the route query `view`.
const props = defineProps<{ modelValue: string; options: ListViewOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div role="group" data-slot="view-switch" class="inline-flex items-center gap-0.5 rounded-full bg-elevated/40 p-0.5 ring ring-default" :aria-label="t('states.view')">
    <UTooltip v-for="option in props.options" :key="option.value" :text="option.label">
      <UButton
        type="button"
        color="neutral"
        square
        size="sm"
        :variant="option.value === props.modelValue ? 'soft' : 'ghost'"
        :icon="option.icon"
        :aria-label="option.label"
        :aria-pressed="option.value === props.modelValue"
        :disabled="!hydrated"
        :data-view="option.value"
        :data-testid="option.testId"
        @click="emit('update:modelValue', option.value)"
      />
    </UTooltip>
  </div>
</template>
