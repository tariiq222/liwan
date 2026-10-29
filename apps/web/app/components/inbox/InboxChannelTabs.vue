<script setup lang="ts">
// The sections of one channel in channel administration: its details, number health, business profile and templates.
const props = defineProps<{ channelId: number }>()
const route = useRoute()
const { t } = useI18n()
const base = computed(() => `/settings/apps/inbox/channels/${props.channelId}`)
const current = computed(() => {
  const path = route.path.replace(/\/+$/, '')
  if (path.endsWith('/health')) return 'health'
  if (path.endsWith('/profile')) return 'profile'
  return path.includes('/templates') ? 'templates' : 'details'
})
const items = computed(() => (['details', 'health', 'profile', 'templates'] as const).map(id => ({
  key: `inbox-channel-tab-${id}`,
  label: t(`inbox.health.tabs.${id}`),
  to: id === 'details' ? base.value : `${base.value}/${id}`,
  active: current.value === id,
})))
</script>

<template>
  <SharedRouteTabs :items="items" :ariaLabel="t('inbox.health.tabs.label')" />
</template>
