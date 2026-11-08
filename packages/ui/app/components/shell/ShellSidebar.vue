<script setup lang="ts">
import BrandWordmark from '../shared/layout/BrandWordmark.vue'

// The one sidebar: the brand mark, then whatever the app puts in `org` and the default slot (global mode: the
// organisation, the day, the pinned applications; app mode: the open application and its links), and `footer`
// (settings and the account). `surface="drawer"` is the same content flat inside the phone drawer.
// Presentational: labels and rows come in as props and slots.
const props = withDefaults(defineProps<{
  /** Accessible name of the landmark. */
  label: string
  /** Where the brand mark leads (the user's start page). */
  homeTo: string
  /** The product name beside the mark. */
  brandName: string
  /** Small line under the product name. */
  caption?: string
  /** `sidebar` is the fixed desktop column, `drawer` the flat copy inside the phone drawer. */
  surface?: 'sidebar' | 'drawer'
  /** `global` lists the day and the applications, `app` the links of the open application. */
  mode?: 'global' | 'app'
  /** Prefix of the test id, so the drawer copy and the column never share one. */
  testIdPrefix?: string
}>(), { surface: 'sidebar', mode: 'global', testIdPrefix: '' })
defineSlots<{ org?: () => unknown; default?: () => unknown; footer?: () => unknown }>()
</script>

<template>
  <aside class="liwan-sidebar liwan-print-hide" :data-testid="`${props.testIdPrefix}application-navigation`" :data-surface="props.surface" :data-mode="props.mode" :aria-label="props.label">
    <NuxtLink :to="props.homeTo" class="liwan-side-brand" :aria-label="`${props.brandName}: ${props.label}`">
      <BrandWordmark size="lg" mark-only />
      <span class="liwan-side-brand-copy">
        <span class="liwan-side-brand-name">{{ props.brandName }}</span>
        <span v-if="props.caption" class="liwan-side-brand-caption">{{ props.caption }}</span>
      </span>
    </NuxtLink>
    <Transition name="liwan-side-orgslot">
      <div v-if="$slots.org" class="liwan-side-orgslot"><div><slot name="org" /></div></div>
    </Transition>
    <nav class="liwan-side-body" data-fresh-navigation :aria-label="props.label">
      <!-- Keyed on the mode: switching between the day and an application swaps the body, never the sidebar itself. -->
      <Transition name="liwan-side-swap" mode="out-in">
        <div :key="props.mode" class="liwan-side-swap" :data-mode="props.mode"><slot /></div>
      </Transition>
    </nav>
    <div v-if="$slots.footer" class="liwan-side-footer">
      <slot name="footer" />
    </div>
  </aside>
</template>
