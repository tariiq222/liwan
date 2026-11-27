<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskStageForm from '@/components/helpdesk/settings/HelpdeskStageForm.vue'
import HelpdeskStagesSection from '@/components/helpdesk/settings/HelpdeskStagesSection.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#workflow'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('helpdesk.settings.manage'))
const canRead = computed(() => can('helpdesk.settings.read'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(() => canManage.value || canRead.value)

function retry() {
  if (!hydrated.value) return
  void resources.refetch()
}
</script>

<template>
  <SharedSettingsPage>
    <HelpdeskStagesSection v-if="canRead && resources.data.value" :rows="resources.data.value.stages" :teams="resources.data.value.teams" :can-edit="canManage" />
  </SharedSettingsPage>
  <SharedCreatePanel :title="t('helpdesk.settings.stages.add')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="resources.isPending.value" :error="resources.error.value" @retry="retry">
      <HelpdeskStageForm v-if="resources.data.value" :teams="resources.data.value.teams" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
