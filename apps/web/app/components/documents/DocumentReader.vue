<script setup lang="ts">
import type { DocumentDetail } from '@webvue/contracts'
defineProps<{ document: DocumentDetail }>()
</script>
<template><SharedRichText :html="document.body" size="sm" /></template>
