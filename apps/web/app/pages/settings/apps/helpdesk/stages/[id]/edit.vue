<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskStageForm from '@/components/helpdesk/settings/HelpdeskStageForm.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { queryPositiveInt } from '@/utils/routeQuery'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#workflow'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('helpdesk.settings.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(() => canManage.value && id.value !== null)
const stage = computed(() => resources.data.value?.stages.find(row => row.id === id.value) ?? null)
const loading = computed(() => id.value !== null && resources.isPending.value)
const error = computed(() => id.value === null
  ? { status: 404 }
  : (resources.error.value ?? (!loading.value && resources.data.value && !stage.value ? { status: 404 } : null)))

function retry() {
  if (!hydrated.value) return
  void resources.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('helpdesk.settings.stages.editTitle')" :back-to="backTo" :back-label="t('helpdesk.settings.stages.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedForbiddenState v-if="stage?.shared" :description="t('helpdesk.settings.stages.sharedForbidden')" />
      <SharedFormSection v-else-if="stage && resources.data.value" panel>
        <HelpdeskStageForm :key="stage.id" :stage="stage" :teams="resources.data.value.teams" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
