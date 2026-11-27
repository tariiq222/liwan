<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskTeamForm from '@/components/helpdesk/settings/HelpdeskTeamForm.vue'
import HelpdeskTeamsSection from '@/components/helpdesk/settings/HelpdeskTeamsSection.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#teams'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const canManage = computed(() => can('helpdesk.settings.manage'))
const canRead = computed(() => can('helpdesk.settings.read'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(canRead)
</script>

<template>
  <SharedSettingsPage>
    <HelpdeskTeamsSection v-if="canRead && resources.data.value" :rows="resources.data.value.teams" :can-edit="canManage" />
  </SharedSettingsPage>
  <SharedCreatePanel :title="t('helpdesk.settings.teams.add')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <HelpdeskTeamForm v-else @done="router.replace(backTo)" @cancel="router.push(backTo)" />
  </SharedCreatePanel>
</template>
