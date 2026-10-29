<script setup lang="ts">
import InboxWorkingHoursForm from '@/components/inbox/InboxWorkingHoursForm.vue'
import { useInboxWorkingHours } from '@/composables/inbox/useInboxAutomation'

// The company's working hours: the weekly grid, the timezone and the holidays that decide when the "away" message and
// the rules' hours conditions apply. A department may have its own hours (its edit form in the inbox settings).
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const query = useInboxWorkingHours()
const manage = computed(() => can('inbox.automation.manage'))
</script>

<template>
  <SharedRecordPage
    :title="t('inbox.automation.hours.title')"
    back-to="/settings/apps/inbox"
    :back-label="t('inbox.title')"
    :loading="manage && query.isPending.value"
    :error="manage ? query.error.value : undefined"
    @retry="hydrated && query.refetch()"
  >
    <SharedForbiddenState v-if="!manage" />
    <InboxWorkingHoursForm v-else-if="query.data.value" :hours="query.data.value" />
  </SharedRecordPage>
</template>
