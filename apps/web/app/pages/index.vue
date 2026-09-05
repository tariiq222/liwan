<script setup lang="ts">
import { firstAllowedPath } from '@/utils/accessPolicy'
const { me, ready } = useMe()
await ready
await navigateTo(firstAllowedPath(me.value))
</script>

<template><span class="sr-only" /></template>
