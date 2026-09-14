<script setup lang="ts">
import { accessTone } from '@/utils/statusTone'

const props = defineProps<{
  active: boolean
  protected?: boolean
  readOnly?: boolean
}>()

const { t } = useI18n()
const tone = computed(() => props.readOnly ? 'neutral' : accessTone(props.active))
</script>

<template>
  <span class="nasq-ui-status-pill" :data-tone="tone">
    {{ protected ? t('access.protected') : readOnly ? t('access.readOnly') : active ? t('access.active') : t('access.disabled') }}
  </span>
</template>
