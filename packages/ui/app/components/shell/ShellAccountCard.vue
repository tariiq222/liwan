<script setup lang="ts">
// The account card of the sidebar footer: avatar (with the live-connection dot), name and role line; it opens the
// self-service page. `connected` is null before the client knows, and then no dot is drawn.
const props = defineProps<{
  name: string
  initial: string
  caption?: string
  to: string
  connected?: boolean | null
  /** Accessible name of the link ("self-service: Sara"). */
  label: string
  connectedLabel?: string
  disconnectedLabel?: string
  disabled?: boolean
}>()
</script>

<template>
  <NuxtLink :to="props.to" class="liwan-side-account" data-slot="header-account" data-testid="account-menu" :aria-label="props.label" :aria-disabled="props.disabled || undefined" :tabindex="props.disabled ? -1 : undefined">
    <span data-slot="avatar">
      <span aria-hidden="true">{{ props.initial }}</span>
      <span v-if="props.connected !== null && props.connected !== undefined" data-slot="status" :data-connected="props.connected" :title="props.connected ? props.connectedLabel : props.disconnectedLabel" role="status" />
    </span>
    <span data-slot="copy">
      <span data-slot="name">{{ props.name }}</span>
      <span v-if="props.caption" data-slot="caption">{{ props.caption }}</span>
    </span>
  </NuxtLink>
</template>
