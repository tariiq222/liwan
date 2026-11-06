<script setup lang="ts">
// The decorative divider of the LiwanOS Sadu identity: a hairline in sand with a Sadu dot at its centre and a smaller
// one on each side. Hidden from assistive technology.
</script>

<template>
  <div data-slot="sadu-divider" role="presentation" aria-hidden="true" class="flex items-center gap-1.5 text-(--liwan-sand)">
    <span class="h-px flex-1 bg-current" />
    <span class="size-1 rotate-45 bg-current" />
    <span class="size-2 rotate-45 bg-primary" />
    <span class="size-1 rotate-45 bg-current" />
    <span class="h-px flex-1 bg-current" />
  </div>
</template>
