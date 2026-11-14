<script setup lang="ts">
import { visibleSettingsPages } from '@/composables/nav/shellModules'

// The settings entry address: it opens the first page the user can reach, the same target its sidebar link uses.
const { t } = useI18n()
const { me, ready } = useMe()
await ready
const first = visibleSettingsPages(me.value)[0]
if (first) await navigateTo(first.parts[0]!.to ?? first.page.to, { replace: true })
</script>

<template>
  <SharedSettingsPage v-if="!first">
    <SharedPageHeader :title="t('settings.title')" />
    <SharedEmptyState bordered :title="t('settings.forbidden')" />
  </SharedSettingsPage>
</template>
