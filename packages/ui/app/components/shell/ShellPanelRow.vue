<script setup lang="ts">
// One row of a slide-over list: a leading mark (an avatar letter, an app tile, a checkbox, or nothing), the title and
// a caption. Opening it is a link (or, without `to`, a button the app handles); `unread` tints it and `done` strikes the title through.
const props = defineProps<{
  title: string
  caption?: string
  to?: string
  /** A letter in a ink circle, for people and conversations. */
  lead?: string
  /** The row leads with an icon tile (in the application's colour when `app` is set, ink otherwise). */
  icon?: string
  app?: string
  /** `check` draws the task box (`done` ticks it). */
  check?: boolean
  done?: boolean
  unread?: boolean
  testId?: string
}>()
const emit = defineEmits<{ select: [] }>()
const link = resolveComponent('NuxtLink')
</script>

<template>
  <component :is="props.to ? link : 'button'" v-bind="props.to ? { to: props.to } : { type: 'button' }" class="liwan-panel-row" :data-unread="props.unread ? 'true' : undefined" :data-done="props.done ? 'true' : undefined" :data-testid="props.testId" @click="emit('select')">
    <ShellAppTile v-if="props.icon" :icon="props.icon" :app="props.app" />
    <span v-else-if="props.check" data-slot="check" aria-hidden="true"><UIcon v-if="props.done" name="i-lucide-check" class="size-3.5" /></span>
    <span v-else-if="props.lead" data-slot="lead" aria-hidden="true">{{ props.lead }}</span>
    <span data-slot="copy">
      <span data-slot="title"><bdi dir="auto">{{ props.title }}</bdi></span>
      <span v-if="props.caption" data-slot="caption"><bdi dir="auto">{{ props.caption }}</bdi></span>
    </span>
    <slot />
  </component>
</template>
