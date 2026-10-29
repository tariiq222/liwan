<script setup lang="ts">
import InboxRuleForm from '@/components/inbox/InboxRuleForm.vue'
import { useInboxRule } from '@/composables/inbox/useInboxAutomation'

// One rule, edited on its own page.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const backTo = '/settings/apps/inbox/rules'
const query = useInboxRule(id)
</script>

<template>
  <SharedRecordPage
    :title="query.data.value?.name ?? t('inbox.automation.rules.title')"
    :back-to="backTo"
    :back-label="t('inbox.automation.rules.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <InboxRuleForm v-if="query.data.value && can('inbox.automation.manage')" :key="query.data.value.id" :rule="query.data.value" :back-to="backTo" @saved="navigateTo(backTo)" />
    <SharedForbiddenState v-else-if="query.data.value" />
  </SharedRecordPage>
</template>
