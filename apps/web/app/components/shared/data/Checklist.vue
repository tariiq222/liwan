<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

export interface SharedChecklistItem {
  id: number
  name: string
  to: RouteLocationRaw
  done?: boolean
  /** A cancelled row shows this label instead of a toggle. */
  cancelledLabel?: string
  /** Label of the toggle button (for example done / reopen). */
  toggleLabel?: string
  toggleIcon?: string
}

// A short checklist of linked items (sub-tasks): each row opens its own page, may carry a status
// slot, and may offer a toggle; below it a one-line form adds an item by name. It runs no request:
// `add` and `toggle` are async handlers of the app, which reports failures through `error`.
// The handlers are props so the name is cleared and the busy mark ends only after they finish.
const props = withDefaults(defineProps<{
  items: SharedChecklistItem[]
  emptyText: string
  addPlaceholder: string
  addLabel: string
  add: (name: string) => Promise<boolean | void>
  toggle?: (item: SharedChecklistItem) => Promise<void>
  canAdd?: boolean
  doneLabel?: string
  error?: string
}>(), { canAdd: false })

const hydrated = useHydrated()
const name = defineModel<string>('draft', { default: '' })
const adding = ref(false)
const busyId = ref<number | null>(null)

async function submit() {
  const title = name.value.trim()
  if (adding.value || !title) return
  adding.value = true
  try {
    // The handler answers `false` when the item was not created, so the typed name is kept.
    if ((await props.add(title)) !== false) name.value = ''
  } finally {
    adding.value = false
  }
}

async function onToggle(item: SharedChecklistItem) {
  if (busyId.value !== null || !props.toggle) return
  busyId.value = item.id
  try {
    await props.toggle(item)
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="space-y-3">
    <ul v-if="items.length" class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex min-w-0 items-center gap-3 py-2">
        <slot name="leading" :item="item" />
        <NuxtLink
          :to="item.to"
          class="min-w-0 flex-1 truncate text-sm text-highlighted hover:underline"
          :class="item.cancelledLabel || item.done ? 'text-muted line-through' : ''"
        >{{ item.name }}</NuxtLink>
        <UBadge v-if="item.cancelledLabel" variant="subtle" color="neutral">{{ item.cancelledLabel }}</UBadge>
        <UButton
          v-else-if="toggle && item.toggleLabel"
          type="button"
          size="xs"
          color="neutral"
          variant="outline"
          :icon="item.toggleIcon"
          :label="item.toggleLabel"
          :aria-label="`${item.toggleLabel}: ${item.name}`"
          :loading="busyId === item.id"
          :disabled="!hydrated || busyId !== null"
          @click="onToggle(item)"
        />
        <UBadge v-else-if="item.done && doneLabel" variant="subtle" color="success">{{ doneLabel }}</UBadge>
      </li>
    </ul>
    <p v-else class="py-2 text-sm text-muted">{{ emptyText }}</p>

    <form v-if="canAdd" class="flex items-end gap-2" @submit.prevent="submit">
      <UInput v-model="name" :placeholder="addPlaceholder" :aria-label="addPlaceholder" size="sm" class="min-w-0 flex-1" :disabled="!hydrated || adding" />
      <UButton type="submit" size="sm" variant="outline" :loading="adding" :disabled="!hydrated || adding || !name.trim()" :label="addLabel" />
    </form>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
