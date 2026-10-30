<script setup lang="ts">
import type { DocumentDetail } from '@liwan/contracts'
defineProps<{ document: DocumentDetail }>()
</script>
<template><SharedRichText :html="document.body" size="sm" /></template>
