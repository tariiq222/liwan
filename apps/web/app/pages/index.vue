<script setup lang="ts">
const { me } = useMe()
</script>

<template>
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">اليوم</h1>
    <p class="text-muted-foreground">مرحبًا {{ me?.name }} — لا شيء مستحق اليوم.</p>
  </div>
</template>
