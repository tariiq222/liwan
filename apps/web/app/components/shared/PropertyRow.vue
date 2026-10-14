<script setup lang="ts">
// One property: a term and its value. An empty value keeps the visual dash but is spoken as "no value".
const props = defineProps<{ label: string; value?: string | number | null }>()
const slots = useSlots()
const { t } = useI18n()
const empty = computed(() => !slots.default && (props.value === null || props.value === undefined || String(props.value).trim() === ''))
</script>

<template>
  <div data-slot="property-row" class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-3 py-2.5 text-sm">
    <dt class="text-muted">{{ props.label }}</dt>
    <dd class="min-w-0 break-words text-highlighted"><slot><template v-if="empty"><span aria-hidden="true">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template><template v-else>{{ props.value }}</template></slot></dd>
  </div>
</template>
