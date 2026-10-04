<script setup lang="ts">
import { DISPLAY_STATE_COLORS, DISPLAY_STATE_KEYS, type SubscriptionDisplayState } from '@/utils/subscription'
defineProps<{ state: SubscriptionDisplayState }>()
const { t } = useI18n()
</script>
<template>
  <UBadge :color="DISPLAY_STATE_COLORS[state]" variant="subtle" data-slot="subscription-state" :data-state="state">{{ t(DISPLAY_STATE_KEYS[state]) }}</UBadge>
</template>
