<script setup lang="ts">
import { parseReportListRoute, reportListPath } from '@/utils/projectFinance'

const route = useRoute()
await navigateTo(reportListPath(parseReportListRoute(route.query as Record<string, unknown>)), { replace: true })
</script>

<template>
  <div aria-hidden="true" />
</template>
