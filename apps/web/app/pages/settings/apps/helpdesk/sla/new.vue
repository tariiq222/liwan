<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskSlaForm from '@/components/helpdesk/settings/HelpdeskSlaForm.vue'
import HelpdeskSlaSection from '@/components/helpdesk/settings/HelpdeskSlaSection.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { useHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#sla'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('helpdesk.settings.manage'))
const canRead = computed(() => can('helpdesk.settings.read'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(() => canManage.value || canRead.value)
const sla = useHelpdeskSla(canRead)

function retry() {
  if (!hydrated.value) return
  void resources.refetch()
}
</script>

<template>
  <SharedSettingsPage>
    <HelpdeskSlaSection
      v-if="canRead && resources.data.value && sla.data.value"
      :rows="sla.data.value.items"
      :stages="resources.data.value.stages"
      :teams="resources.data.value.teams"
      :categories="resources.data.value.categories"
      :tags="resources.data.value.tags"
      :can-edit="canManage"
    />
  </SharedSettingsPage>
  <SharedCreatePanel :title="t('helpdesk.settings.sla.add')" :back-to="backTo">
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="resources.isPending.value" :error="resources.error.value" @retry="retry">
      <HelpdeskSlaForm
        v-if="resources.data.value"
        :stages="resources.data.value.stages"
        :teams="resources.data.value.teams"
        :categories="resources.data.value.categories"
        :tags="resources.data.value.tags"
        @done="router.replace(backTo)"
        @cancel="router.push(backTo)"
      />
    </SharedPageState>
  </SharedCreatePanel>
</template>
