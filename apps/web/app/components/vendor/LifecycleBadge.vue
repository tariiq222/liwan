<script setup lang="ts">
import { lifecycleStatus, type LifecycleStatus } from '@/utils/vendorCommercial'
const props = defineProps<{ status: string; available?: boolean }>()
const { t } = useI18n()
const state = computed<LifecycleStatus>(() => lifecycleStatus({ status: props.status, available: props.available ?? true }))
const color = computed(() => ({ draft: 'neutral', validated: 'info', published: 'success', withdrawn: 'warning' } as const)[state.value])
</script>
<template><UBadge :color="color" variant="subtle" data-slot="lifecycle-badge">{{ t(`vendor.pricing.status.${state}`) }}</UBadge></template>
