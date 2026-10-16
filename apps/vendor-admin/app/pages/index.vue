<script setup lang="ts">
// A route redirect, not a navigation from inside the page: a redirect started while the page renders never repaints after a client-side move (sign-in, enrollment).
definePageMeta({ capability: 'vendor.read', redirect: '/overview' })
</script>
<template><div /></template>
