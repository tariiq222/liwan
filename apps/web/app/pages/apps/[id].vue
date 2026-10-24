<script setup lang="ts">
import { appStartFor } from '@/composables/nav/appStartModel'
import { useAttention } from '@/composables/useAttention'

// The generic start page of an application, from its manifest alone: attention rows, then the pages and create actions to start from.
const { t } = useI18n()
const route = useRoute()
const { me } = useMe()
const id = computed(() => String(route.params.id ?? ''))
const start = computed(() => appStartFor(id.value, me.value))
const { rows: attention } = useAttention(() => (start.value.kind === 'ready' ? id.value : null), { limit: 10 })
</script>

<template>
  <SharedPageContainer width="list" data-testid="app-start-page">
    <template v-if="start.kind === 'ready'">
      <SharedPageHeader :title="t(start.labelKey)" :icon="start.icon" back-to="/apps" :back-label="t('nav.apps')">
        <template #actions><UButton :to="start.openTo" color="primary" class="rounded-full" :label="t('appStart.open')" data-testid="app-start-open" /></template>
      </SharedPageHeader>
      <AppsStartContent :attention="attention" :cards="start.cards" :creates="start.creates" />
    </template>
    <template v-else>
      <SharedPageHeader :title="t('nav.apps')" back-to="/apps" />
      <SharedForbiddenState v-if="start.kind === 'forbidden'" />
      <SharedNotFoundState v-else back-to="/apps" :back-label="t('nav.apps')" />
    </template>
  </SharedPageContainer>
</template>
