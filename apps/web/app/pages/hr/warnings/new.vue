<script setup lang="ts">
import WarningForm from '@/components/hr/warnings/WarningForm.vue'
import { owningListBack } from '@/utils/recordListOrigin'
import type { HrWarning } from '@/composables/useHrWarnings'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

const sourcePaths = useRecordListPaths(['/hr/warnings'])
// A direct manager cannot open the list (no hr.warnings.read): cancel returns to his own warnings page.
const backTo = computed(() => can('hr.warnings.read') ? owningListBack(route.query, sourcePaths.value, route.hash) : '/account/warnings')
// The server decides who may issue: HR, or a direct manager when the company lets managers issue.
const issuer = useHrWarningIssuer()
const types = useHrWarningTypes('true')
const candidates = useHrWarningCandidates(issuer.canIssue)

function saved(warning: HrWarning) {
  void navigateTo({
    path: `/hr/warnings/${warning.id}`,
    query: { returnTo: router.resolve(backTo.value).fullPath },
  }, { replace: true })
}
</script>

<template>
  <SharedCreatePanel :title="t('hrWarnings.new')" :back-to="backTo">
    <SharedPageState :loading="issuer.isLoading.value" :error="issuer.error.value" @retry="issuer.refetch">
      <SharedForbiddenState v-if="!issuer.canIssue.value" />
      <SharedPageState v-else :loading="types.isLoading.value || candidates.isLoading.value" :error="types.error.value ?? candidates.error.value" @retry="types.refetch(); candidates.refetch()">
        <WarningForm :employees="candidates.data.value?.items ?? []" :types="types.data.value?.items ?? []" :back-to="backTo" @saved="saved" />
      </SharedPageState>
    </SharedPageState>
  </SharedCreatePanel>
</template>
