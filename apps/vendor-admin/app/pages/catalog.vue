<script setup lang="ts">
definePageMeta({ capability: 'vendor.read' })
const { t } = useI18n()
useSectionCrumb(() => ({ label: t('vendor.packages.title'), to: '/catalog' }))
</script>
<template><NuxtPage /></template>
