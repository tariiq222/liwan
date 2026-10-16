<script setup lang="ts">
// The primary sign-in control. It is not inside a form, so it is never submitted natively; it only
// becomes live once the page has hydrated (a click before that would be dropped).
defineProps<{ label: string, pending?: boolean }>()
defineEmits<{ click: [] }>()
const hydrated = useHydrated()
</script>

<template>
  <UButton
    type="button"
    size="lg"
    block
    icon="i-lucide-key-round"
    :label="label"
    :loading="pending"
    :disabled="!hydrated || pending"
    @click="$emit('click')"
  />
</template>
