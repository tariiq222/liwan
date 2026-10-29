<script setup lang="ts">
// /finance/reports has no page of its own: it opens the first report of the sidebar list.
await navigateTo('/finance/reports/trial-balance', { replace: true })
</script>

<template>
  <SharedPageContainer />
</template>
