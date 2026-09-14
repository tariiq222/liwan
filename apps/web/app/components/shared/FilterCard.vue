<template>
  <div data-slot="filter-root" class="min-w-0 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-slot="search" class="min-w-48 flex-1">
        <slot name="search" />
      </div>
      <UButton v-if="$slots.default" ref="trigger" type="button" color="neutral" :variant="expanded ? 'soft' : 'outline'" square icon="i-lucide-list-filter" :aria-label="resolvedTitle" :title="resolvedTitle" :aria-expanded="expanded" :aria-controls="contentId" :disabled="isDisabled" @click="expanded = !expanded" />
      <UBadge v-if="activeCount > 0" color="secondary">{{ activeCount }}</UBadge>
      <UButton v-if="activeCount > 0" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="resolvedClearLabel" :title="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')" />
      <slot name="actions" />
    </div>
    <div v-if="$slots.default" v-show="expanded" :id="contentId" class="nasq-ui-filter-row" data-slot="filter-fields" :aria-label="resolvedTitle" role="region" :aria-busy="isDisabled" @keydown.esc.stop="close"><slot /></div>
    <div v-if="activeCount > 0 && $slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2 text-xs text-muted"><slot name="active" /></div>
  </div>
</template>

<script setup lang="ts">

const props = withDefaults(defineProps<{
  title?: string
  activeCount?: number
  clearLabel?: string
  disabled?: boolean
  defaultOpen?: boolean
}>(), {
  activeCount: 0,
  disabled: false,
  defaultOpen: false,
})
defineEmits<{
  clear: []
}>()
const { t } = useI18n()
const hydrated = useHydrated()
const expanded = ref(props.defaultOpen)
const trigger = ref<{ $el?: HTMLElement } | null>(null)
function close() {
  expanded.value = false
  trigger.value?.$el?.focus()
}
const contentId = `filter-card-${useId()}`
const activeCount = computed(() => Math.max(0, props.activeCount ?? 0))
const isDisabled = computed(() => props.disabled || !hydrated.value)
const resolvedTitle = computed(() => props.title || t('filterCard.title'))
const resolvedClearLabel = computed(() => props.clearLabel || t('filterCard.clear'))
</script>
