<script setup lang="ts">
// Retired create route: kept only so old links land on the read-only package list.
definePageMeta({ capability: 'vendor.read', redirect: to => ({ path: '/catalog', query: to.query }) })
</script>
<template><SharedPageContainer width="list" /></template>
