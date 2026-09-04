<script setup lang="ts">
const { me } = useMe()
</script>

<template>
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">{{ $t('today.title') }}</h1>
    <p class="text-muted-foreground">{{ $t('today.greeting', { name: me?.name }) }}</p>
  </div>
</template>
