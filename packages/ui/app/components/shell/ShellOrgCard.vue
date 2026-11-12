<script setup lang="ts">
// The organisation card under the brand: the tenant's logo, or its initial on the ink tile, and its name.
// It is a static card: it names where the person works and switches nothing. The application decides the name.
const props = defineProps<{ name: string; initial: string; logoUrl?: string | null }>()
</script>

<template>
  <ShellTip :label="props.name">
    <div class="liwan-side-org" data-testid="shell-org">
      <img v-if="props.logoUrl" :src="props.logoUrl" alt="">
      <span v-else data-slot="initial" aria-hidden="true">{{ props.initial }}</span>
      <span data-slot="name">{{ props.name }}</span>
    </div>
  </ShellTip>
</template>
