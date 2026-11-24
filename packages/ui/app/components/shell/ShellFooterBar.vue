<script setup lang="ts">
import type { ShellFooterTool } from '../../types/shell'

// The sidebar's bottom group: one row of icon-only buttons (a link when the tool has `to`, a plain button when it has none),
// (a tool marked `disabled` is `aria-disabled` and stays focusable for its tooltip), and a last chevron button that opens the full vertical list (the default slot) above the row and closes it again.
// Every button carries its name as its accessible name and an always-on tooltip, because the row has no labels. Between
// 768px and 1099px the sidebar is an icon strip: the row stands upright and the chevron and the list drop out.
// Presentational: the tools, the names and the open flag come in as props, the list as a slot.
const props = withDefaults(defineProps<{
  /** Accessible name of the row. */
  label: string
  tools: ShellFooterTool[]
  /** Name of the chevron button while the list is closed. */
  expandLabel: string
  /** Name of the chevron button while the list is open. */
  collapseLabel: string
  /** Prefix of every test id, so the drawer copy and the column never share one. */
  testIdPrefix?: string
  hydrated?: boolean
}>(), { hydrated: true })
const emit = defineEmits<{ navigate: [tool: ShellFooterTool] }>()
const expanded = defineModel<boolean>('expanded', { default: false })
const listId = useId()
const prefix = computed(() => props.testIdPrefix ?? '')
const list = ref<HTMLElement | null>(null)
// Opening by the chevron moves focus to the first link of the list, so a keyboard user lands inside what just appeared.
async function toggle() {
  const next = !expanded.value
  expanded.value = next
  if (!next) return
  await nextTick()
  list.value?.querySelector<HTMLElement>('a')?.focus()
}
const toggleLabel = computed(() => (expanded.value ? props.collapseLabel : props.expandLabel))
</script>

<template>
  <div class="liwan-side-foot">
    <div v-if="expanded" :id="listId" ref="list" class="liwan-side-foot-list" :data-testid="`${prefix}footer-list`">
      <slot />
    </div>
    <div class="liwan-side-foot-bar" role="group" :aria-label="props.label" :data-testid="`${prefix}footer-tools`">
      <ShellTip v-for="tool in props.tools" :key="tool.id" :label="tool.label" always>
        <NuxtLink
          v-if="tool.to"
          :to="tool.to"
          class="liwan-core-app"
          :data-active="tool.active ? 'true' : undefined"
          :aria-current="tool.active ? 'page' : undefined"
          :aria-label="tool.label"
          :data-testid="`${prefix}footer-tool-${tool.id}`"
          @click="emit('navigate', tool)"
        >
          <UIcon :name="tool.icon" aria-hidden="true" />
        </NuxtLink>
        <button v-else type="button" class="liwan-core-app" :aria-label="tool.label" :aria-disabled="tool.disabled ? 'true' : undefined" :data-testid="`${prefix}footer-tool-${tool.id}`">
          <UIcon :name="tool.icon" aria-hidden="true" />
        </button>
      </ShellTip>
      <ShellTip :label="toggleLabel" always>
        <button
          type="button"
          class="liwan-core-app liwan-foot-toggle"
          :aria-expanded="expanded"
          :aria-controls="expanded ? listId : undefined"
          :aria-label="toggleLabel"
          :disabled="!props.hydrated"
          :data-testid="`${prefix}footer-toggle`"
          @click="toggle"
        >
          <UIcon name="i-lucide-chevron-up" aria-hidden="true" />
        </button>
      </ShellTip>
    </div>
  </div>
</template>
