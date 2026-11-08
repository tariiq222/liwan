<script setup lang="ts">
// The organisation card under the brand: the tenant's logo, or its initial on the ink tile, and its name.
// It is a static card: LiwanOS keeps one organisation per sign-in, so there is nothing to switch.
const props = defineProps<{ name: string; initial: string; logoUrl?: string | null }>()
</script>

<template>
  <div class="liwan-side-org" data-testid="shell-org">
    <img v-if="props.logoUrl" :src="props.logoUrl" alt="">
    <span v-else data-slot="initial" aria-hidden="true">{{ props.initial }}</span>
    <span data-slot="name">{{ props.name }}</span>
  </div>
</template>
