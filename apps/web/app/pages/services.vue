<script setup lang="ts">
import { serviceGroups } from '@/composables/nav/servicesStartModel'

const { t } = useI18n()
const { me } = useMe()
const groups = computed(() => serviceGroups(me.value))
</script>

<template>
  <SharedPageContainer width="list" data-testid="services-page">
    <SharedPageHeader :title="t('services.title')" icon="i-lucide-hand-helping" />
    <p class="text-sm text-muted">{{ t('services.description') }}</p>
    <ServicesGroups v-if="groups.length" :groups="groups" />
    <SharedEmptyState v-else bordered :title="t('services.empty')">
      <template #action><UButton to="/apps" color="neutral" variant="outline" class="rounded-full" :label="t('services.browseApps')" /></template>
    </SharedEmptyState>
  </SharedPageContainer>
</template>
