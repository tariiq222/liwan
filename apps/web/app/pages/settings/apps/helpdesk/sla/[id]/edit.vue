<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import HelpdeskSlaForm from '@/components/helpdesk/settings/HelpdeskSlaForm.vue'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { useHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'
import { queryPositiveInt } from '@/utils/routeQuery'

const DEFAULT_BACK_TO = '/settings/apps/helpdesk#sla'
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('helpdesk.settings.manage'))
const id = computed(() => queryPositiveInt(route.params.id))
const backTo = computed(() => safeReturnTo(route.query.returnTo, DEFAULT_BACK_TO, ['/settings/apps/helpdesk']))
const resources = useHelpdeskResources(() => canManage.value && id.value !== null)
const sla = useHelpdeskSla(() => canManage.value && id.value !== null)
const policy = computed(() => sla.data.value?.items.find(row => row.id === id.value) ?? null)
const loading = computed(() => id.value !== null && (resources.isPending.value || sla.isPending.value))
const error = computed(() => id.value === null
  ? { status: 404 }
  : (sla.error.value ?? resources.error.value ?? (!loading.value && sla.data.value && !policy.value ? { status: 404 } : null)))

function retry() {
  if (!hydrated.value) return
  if (sla.error.value) void sla.refetch()
  if (resources.error.value) void resources.refetch()
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('helpdesk.settings.sla.editTitle')" :back-to="backTo" :back-label="t('helpdesk.settings.sla.title')" />
    <SharedForbiddenState v-if="!canManage" :description="t('errors.forbidden')" />
    <SharedPageState v-else :loading="loading" :error="error" @retry="retry">
      <SharedFormSection v-if="policy && resources.data.value" panel>
        <HelpdeskSlaForm
          :key="policy.id"
          :policy="policy"
          :stages="resources.data.value.stages"
          :teams="resources.data.value.teams"
          :categories="resources.data.value.categories"
          :tags="resources.data.value.tags"
          @done="router.replace(backTo)"
          @cancel="router.push(backTo)"
        />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
