<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

export interface RowAction {
  label: string
  icon?: `i-lucide-${string}`
  to?: RouteLocationRaw
  onSelect?: () => void
  /** Destructive actions sit last, in the error colour, and open their own inline confirmation. */
  destructive?: boolean
  disabled?: boolean
}

// Actions for one record row or card. A single non-destructive action is a
// quiet link-style button; anything more (or any destructive action) goes into
// one "more" menu so every list reads the same.
const props = defineProps<{
  actions: RowAction[]
  /** Names the record for the menu button, e.g. "إجراءات مشروع ألفا". */
  label: string
  disabled?: boolean
}>()
const hydrated = useHydrated()

const visible = computed(() => props.actions.filter(Boolean))
const single = computed(() => visible.value.length === 1 && !visible.value[0]!.destructive ? visible.value[0]! : null)
const menuItems = computed(() => {
  const plain = visible.value.filter(action => !action.destructive)
  const destructive = visible.value.filter(action => action.destructive)
  const toItem = (action: RowAction) => ({
    label: action.label,
    icon: action.icon,
    to: action.to,
    color: action.destructive ? 'error' as const : undefined,
    disabled: action.disabled,
    onSelect: action.onSelect,
  })
  return destructive.length ? [plain.map(toItem), destructive.map(toItem)] : [plain.map(toItem)]
})
</script>

<template>
  <UButton
    v-if="single"
    color="neutral"
    variant="link"
    size="sm"
    :icon="single.icon"
    :label="single.label"
    :to="single.to"
    :disabled="props.disabled || single.disabled || !hydrated"
    data-testid="row-action"
    @click.stop="single.onSelect?.()"
  />
  <UDropdownMenu v-else-if="visible.length" :items="menuItems" :content="{ align: 'end' }">
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      square
      size="sm"
      icon="i-lucide-ellipsis"
      :aria-label="props.label"
      :disabled="props.disabled || !hydrated"
      data-testid="row-actions-menu"
      @click.stop
    />
  </UDropdownMenu>
</template>
