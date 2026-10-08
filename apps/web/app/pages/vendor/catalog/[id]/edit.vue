<script setup lang="ts">
import { packageListReturnTo } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute()
const backTo = computed(() => packageListReturnTo(route.query.returnTo))
</script>
<template>
  <SharedCreatePanel :title="t('vendor.packages.title')" :back-to="backTo" width="wide">
    <SharedPageState :empty="true" :empty-text="t('vendor.packages.retired')" />
  </SharedCreatePanel>
</template>
