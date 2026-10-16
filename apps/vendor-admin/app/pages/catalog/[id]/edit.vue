<script setup lang="ts">
// Retired edit route: kept only so old links land on the read-only package view.
definePageMeta({ capability: 'vendor.read', redirect: to => ({ path: `/catalog/${encodeURIComponent(String(to.params.id))}`, query: to.query }) })
</script>
<template><SharedPageContainer width="list" /></template>
