<script setup lang="ts">
import type { ListViewOption } from '../../../utils/listView'
import SegmentedControl from './SegmentedControl.vue'

// The list / board switch (Tasmim spec §6): the icon-only specialisation of SharedSegmentedControl that takes the
// list page's view options. SharedListPage binds it to the route query `view`.
const props = defineProps<{ modelValue: string; options: ListViewOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
</script>

<template>
  <SegmentedControl data-slot="view-switch" icon-only :label="t('states.view')" :items="props.options" :model-value="props.modelValue" @update:model-value="emit('update:modelValue', $event)" />
</template>
