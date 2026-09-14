<template>
  <UButton
    type="button"
    size="xs"
    color="neutral"
    variant="outline"
    trailing-icon="i-lucide-x"
    data-slot="filter-chip"
    :label="label"
    :aria-label="`${t('filterCard.remove')}: ${label}`"
    :disabled="disabled || !hydrated"
    @click="$emit('remove')"
  />
</template>

<script setup lang="ts">
defineProps<{ label: string; disabled?: boolean }>()
defineEmits<{ remove: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>
