<script setup lang="ts">
import { useNav } from '@/composables/nav/shellModules'
import { visibleCommands } from '@/composables/nav/paletteModel'
import { postLoginPath } from '@/utils/accessPolicy'
const { t } = useI18n()
const { me, ready } = useMe()
await ready
if (!Array.isArray(me.value?.capabilities)) await navigateTo(postLoginPath(me.value, undefined))
const destinations = computed(() => useNav(me.value).filter(item => item.to !== '/' && item.to !== '/odoo' && !item.to.startsWith('/vendor')))
const actions = computed(() => visibleCommands(me.value))
</script>

<template>
  <SharedListPage :title="t('nav.home')" :description="t('home.description')" data-testid="foundation-home">
    <SharedRecordSection v-if="destinations.length" :title="t('nav.goTo')">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UButton v-for="item in destinations" :key="item.to" :to="item.to" :icon="item.icon" color="neutral" variant="outline" class="min-h-14 justify-start whitespace-normal" :label="t(item.labelKey)" />
      </div>
    </SharedRecordSection>
    <SharedRecordSection v-if="actions.length" :title="t('app.actions')">
      <div class="flex flex-wrap gap-3">
        <UButton v-for="action in actions" :key="action.id" :to="{ path: action.to, query: { returnTo: '/' } }" :icon="action.icon" color="neutral" variant="soft" :label="t(action.labelKey)" />
      </div>
    </SharedRecordSection>
    <SharedEmptyState v-if="!destinations.length && !actions.length" :title="t('home.empty')">
      <template #action><UButton to="/account" color="neutral" variant="outline" :label="t('nav.account')" /></template>
    </SharedEmptyState>
  </SharedListPage>
</template>
