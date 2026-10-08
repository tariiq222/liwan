<script setup lang="ts">
// Retired create route: kept only so old links land on the read-only package list.
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read', redirect: to => ({ path: '/vendor/catalog', query: to.query }) })
</script>
<template><SharedPageContainer width="list" /></template>
