<script setup lang="ts">
import { useCustomerCapabilities, useSubscriptionApi } from '@/composables/useSubscription'
const { t } = useI18n(); const api = useSubscriptionApi(); const { can } = useCustomerCapabilities(); const hydrated = useHydrated()
const allowed = computed(() => can('subscription.read'))
const { data, error, pending, refresh } = await useAsyncData('subscription:branches', () => api.branches(), { immediate: allowed.value })
definePageMeta({ middleware: 'customer-commercial' })
</script>
<template>
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('subscription.branches.title')" back-to="/subscription">
      <template #actions><UButton v-if="can('branches.manage')" to="/subscription/branches/new" icon="i-lucide-plus" :disabled="!hydrated">{{ t('subscription.branches.add') }}</UButton></template>
    </SharedPageHeader>
    <SharedForbiddenState v-if="!allowed" />
    <template v-else>
      <p v-if="!can('branches.manage')" class="text-sm text-muted">{{ t('subscription.branches.readOnly') }}</p>
      <SharedPageState :loading="pending" :error="error" @retry="refresh"><SubscriptionBranchSummary v-if="data" :summary="data" /></SharedPageState>
    </template>
    <NuxtPage />
  </SharedSettingsPage>
</template>
