<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import type { ShellNavigationLink, ShellQuickItem } from '../../types/shell'

// A run of sidebar rows under an optional heading. A row with `children` is a branch: its button opens and closes
// the nested rows, and the branch that holds the current page opens by itself. Props only: the app supplies the rows.
const props = defineProps<{
  /** Accessible name of the group (the heading when there is one). */
  label: string
  title?: string
  /** A link at the end of the heading (the pinned list's edit link). */
  action?: { label: string; to: string }
  items: ShellNavigationLink[]
  /** Prefix of every row's test id, so the drawer copy and the column never share one. */
  testIdPrefix?: string
  hydrated?: boolean
}>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
const [DefineRows, ReuseRows] = createReusableTemplate<{ rows: ShellNavigationLink[]; path: string[] }>()
const selected = (row: ShellNavigationLink): boolean => !!row.active || !!row.children?.some(selected)
const opened = ref(new Set<string>())
const keyOf = (path: string[]) => path.join('/')
function openSelected(rows: ShellNavigationLink[], parent: string[]) {
  for (const row of rows) {
    if (!row.children?.length) continue
    const path = [...parent, row.id]
    if (selected(row)) opened.value.add(keyOf(path))
    openSelected(row.children, path)
  }
}
// The branch with the current page opens whenever the rows change (a route change rebuilds them).
watch(() => props.items, items => openSelected(items, []), { immediate: true })
function toggle(path: string[]) {
  const key = keyOf(path)
  if (opened.value.has(key)) opened.value.delete(key)
  else opened.value.add(key)
}
const testId = (row: ShellNavigationLink) => `${props.testIdPrefix ?? ''}${row.testId}`
</script>

<template>
  <DefineRows v-slot="{ rows, path }">
    <template v-for="row in rows" :key="row.id">
      <template v-if="row.children?.length">
        <ShellTip :label="row.label">
          <button
            type="button"
            class="liwan-side-row"
            :data-active="selected(row) && !opened.has(keyOf([...path, row.id])) ? 'true' : undefined"
            :aria-expanded="opened.has(keyOf([...path, row.id]))"
            :aria-label="row.label"
            :data-testid="testId(row)"
            :disabled="props.hydrated === false"
            @click="toggle([...path, row.id])"
          >
            <span data-slot="icon" aria-hidden="true"><UIcon :name="row.icon" class="liwan-shell-icon" /></span>
            <span data-slot="label">{{ row.label }}</span>
            <UIcon data-slot="chevron" name="i-lucide-chevron-down" class="size-4 shrink-0" aria-hidden="true" />
          </button>
        </ShellTip>
        <div v-if="opened.has(keyOf([...path, row.id]))" class="liwan-side-branch" :data-testid="`${props.testIdPrefix ?? ''}submenu-${[...path, row.id].join('-')}`">
          <ReuseRows :rows="row.children" :path="[...path, row.id]" />
        </div>
      </template>
      <ShellNavRow v-else :item="row" :test-id="testId(row)" @navigate="emit('navigate', $event)" />
    </template>
  </DefineRows>
  <div class="liwan-side-group" role="group" :aria-label="props.title || props.label">
    <div v-if="props.title" class="liwan-side-heading">
      <h3>{{ props.title }}</h3>
      <NuxtLink v-if="props.action" :to="props.action.to" data-testid="side-section-action">{{ props.action.label }}</NuxtLink>
    </div>
    <ReuseRows :rows="props.items" :path="[]" />
  </div>
</template>
