<script setup lang="ts">
definePageMeta({ path: '/account/requests' })
import RequestList from '@/components/operations/RequestList.vue'
import { personalEntries } from '@/composables/nav/personalModel'
const { t } = useI18n()
const { me } = useMe()
const { can } = useAccess()
const hydrated = useHydrated()
const leave = computed(() => personalEntries(me.value).find(entry => entry.section === 'leave'))
</script>
<template>
  <SharedListPage :title="t('operations.personal.title')">
    <template #actions><UButton v-if="can('operations.requests.create')" to="/account/requests/new" icon="i-lucide-plus" :label="t('operations.personal.new')" :disabled="!hydrated" /></template>
    <p class="text-sm text-muted">{{ t('operations.personal.description') }}</p>
    <UButton v-if="leave" :to="leave.to" color="neutral" variant="outline" :icon="leave.icon" :label="t('operations.personal.leaveRequests')" :disabled="!hydrated" class="self-start" />
    <RequestList scope="mine" personal />
  </SharedListPage>
</template>
