<script setup lang="ts">
// A page outside the shell's chrome (Tasmim Plan 4). `card` centres one card on the page
// surface (sign-in, invitations, the error page) and is the page's <main>. `print` is a
// document that sits in the shell's <main> on screen and prints black on white without
// the shell (packages/ui/app/assets/css/components.css, @media print); its `footer` (print and back
// actions) is not printed. The card's `#header` slot replaces the title heading when the page
// needs more than a title (a logo and a sentence); the slot's owner then draws the `<h1>`.
// `width` sets the on-screen width of a `print` page: `detail` for a document of its own,
// `list` inside a frame whose tabs and band span the page (the project charter).
const props = withDefaults(defineProps<{
  variant?: 'card' | 'print'
  title?: string
  width?: 'detail' | 'list'
}>(), {
  variant: 'card',
  width: 'detail',
})
</script>

<template>
  <main v-if="props.variant === 'card'" data-template="standalone-page" data-variant="card" class="grid min-h-svh place-items-center bg-default p-4 md:p-10">
    <UCard class="w-full max-w-md">
      <template v-if="props.title || $slots.header" #header>
        <slot name="header">
          <h1 class="text-center text-2xl font-semibold text-highlighted">{{ props.title }}</h1>
        </slot>
      </template>
      <slot />
      <template v-if="$slots.footer" #footer>
        <slot name="footer" />
      </template>
    </UCard>
  </main>
  <article v-else :class="['nasq-print grid min-w-0 gap-6', props.width === 'list' ? 'nasq-page-width-list' : 'nasq-page-width-detail']" data-template="standalone-page" data-variant="print">
    <h1 v-if="props.title" class="text-2xl font-semibold text-highlighted">{{ props.title }}</h1>
    <slot />
    <footer v-if="$slots.footer" class="nasq-print-hide flex flex-wrap items-center justify-end gap-2">
      <slot name="footer" />
    </footer>
  </article>
</template>
