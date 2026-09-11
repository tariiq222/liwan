<template>
  <div data-slot="filter-root" class="min-w-0 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <UPopover v-model:open="expanded">
        <UButton type="button" color="secondary" square icon="i-lucide-list-filter" :aria-label="resolvedTitle" :title="resolvedTitle" :aria-expanded="expanded" :aria-controls="contentId" :disabled="isDisabled" />
        <template #content>
          <div :id="contentId" class="nasq-ui-filter-content" data-slot="filter-fields" :aria-busy="isDisabled"><slot /></div>
        </template>
      </UPopover>
      <UBadge v-if="activeCount > 0" color="secondary">{{ activeCount }}</UBadge>
      <slot name="actions" />
      <UButton v-if="activeCount > 0" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="resolvedClearLabel" :title="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')" />
    </div>
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
const contentId = `filter-card-${useId()}`
const activeCount = computed(() => Math.max(0, props.activeCount ?? 0))
const isDisabled = computed(() => props.disabled || !hydrated.value)
const resolvedTitle = computed(() => props.title || t('filterCard.title'))
const resolvedClearLabel = computed(() => props.clearLabel || t('filterCard.clear'))
</script>
