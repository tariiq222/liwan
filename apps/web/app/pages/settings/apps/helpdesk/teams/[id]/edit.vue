<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskTeamForm from '@/components/helpdesk/settings/HelpdeskTeamForm.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { queryPositiveInt } from '@/utils/routeQuery'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#teams'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('helpdesk.settings.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(() => canManage.value && id.value !== null)
const team = computed(() => resources.data.value?.teams.find(row => row.id === id.value) ?? null)
const loading = computed(() => id.value !== null && resources.isPending.value)
const error = computed(() => id.value === null
  ? { status: 404 }
  : (resources.error.value ?? (!loading.value && resources.data.value && !team.value ? { status: 404 } : null)))

function retry() {
  if (!hydrated.value) return
  void resources.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('helpdesk.settings.teams.editTitle')" :back-to="backTo" :back-label="t('helpdesk.settings.teams.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedFormSection v-if="team" panel>
        <HelpdeskTeamForm :key="team.id" :team="team" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
