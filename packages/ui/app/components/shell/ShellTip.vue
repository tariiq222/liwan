<script setup lang="ts">
// The name tooltip of a sidebar item. Only the icon-only strip (768px to 1099px) shows it, because the expanded sidebar
// already draws the label. It opens on hover and on keyboard focus, on the inline-end side of the rail, and the wrapped
// element keeps its own aria-label, and the tooltip's description link is dropped so the name is not read twice.
// `always` is for the icon row, which has no labels at any width: the tooltip stays on, and opens below the icon
// while the sidebar is expanded (beside it would cover the next icon).
// Presentational: the label comes in as a prop.
const props = defineProps<{ label: string; always?: boolean }>()
const collapsed = useSidebarCollapsed()
const { localeProperties } = useI18n()
function onOpenChange(open: boolean) {
  if (open) nextTick(() => dropDuplicatedDescription(document))
}
const inlineEnd = computed(() => (localeProperties.value.dir === 'rtl' ? 'left' : 'right'))
const side = computed(() => (props.always && !collapsed.value ? 'bottom' : inlineEnd.value))
</script>

<template>
  <UTooltip
    :text="props.label"
    :disabled="!collapsed && !props.always"
    :delay-duration="300"
    ignore-non-keyboard-focus
    @update:open="onOpenChange"
    :content="{ side, sideOffset: 10 }"
    :ui="{ content: 'h-auto rounded-tag bg-[var(--liwan-ink)] px-2.5 py-1.5 text-[var(--liwan-on-ink)] shadow-lg ring-0', text: 'text-sm font-medium text-[var(--liwan-on-ink)]' }"
  >
    <slot />
  </UTooltip>
</template>
