<template>
  <Card class="w-full overflow-hidden">
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          class="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md text-start text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :aria-expanded="expanded"
          :aria-controls="contentId"
          :disabled="isDisabled"
          @click="expanded = !expanded"
        >
          <span class="truncate">{{ resolvedTitle }}</span>
          <Badge v-if="activeCount > 0" variant="secondary" class="shrink-0">{{ activeCount }}</Badge>
          <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': expanded }" aria-hidden="true" />
        </button>
      </div>
      <div class="ms-auto flex min-w-0 flex-wrap items-center gap-2">
        <slot name="actions" />
        <Button v-if="activeCount > 0" type="button" variant="ghost" size="sm" class="gap-1" :disabled="isDisabled" @click="$emit('clear')">
          <X class="size-3.5" aria-hidden="true" />
          {{ resolvedClearLabel }}
        </Button>
      </div>
    </CardHeader>
    <CardContent :class="expanded || (activeCount > 0 && $slots.active) ? 'space-y-4 px-4 py-4 sm:px-5' : 'p-0'" :aria-busy="isDisabled">
      <div v-show="expanded" :id="contentId" data-slot="filter-fields">
        <slot />
      </div>
      <div v-if="activeCount > 0 && $slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2 [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:break-words">
        <slot name="active" />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ChevronDown, X } from '@lucide/vue'

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
