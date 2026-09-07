<script setup lang="ts">
defineProps<{
  active: boolean
  protected?: boolean
  readOnly?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="active ? 'nasq-status-chip-success' : 'nasq-status-chip-muted'"
  >
    {{ protected ? t('access.protected') : readOnly ? t('access.readOnly') : active ? t('access.active') : t('access.disabled') }}
  </span>
</template>
