<script setup lang="ts">
// Retired edit route: kept only so old links land on the read-only package view.
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read', redirect: to => ({ path: `/vendor/catalog/${encodeURIComponent(String(to.params.id))}`, query: to.query }) })
</script>
<template><SharedPageContainer width="list" /></template>
