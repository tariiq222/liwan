<script setup lang="ts">
import { STATUS_COLOR } from '@/utils/statusTone'

defineProps<{
  active: boolean
  protected?: boolean
  readOnly?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <UBadge :color="STATUS_COLOR[active ? 'success' : 'neutral']" variant="subtle">
    {{ protected ? t('access.protected') : readOnly ? t('access.readOnly') : active ? t('access.active') : t('access.disabled') }}
  </UBadge>
</template>
