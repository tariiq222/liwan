<script setup lang="ts">
import { useHelpdeskSettings } from '@/composables/helpdesk/useHelpdesk'
import { useHelpdeskResources } from '@/composables/helpdesk/useHelpdeskResources'
import { useHelpdeskSla } from '@/composables/helpdesk/useHelpdeskSla'
import HelpdeskPolicyCard from '@/components/helpdesk/settings/HelpdeskPolicyCard.vue'
import HelpdeskSlaSection from '@/components/helpdesk/settings/HelpdeskSlaSection.vue'
import HelpdeskStagesSection from '@/components/helpdesk/settings/HelpdeskStagesSection.vue'
import HelpdeskTeamsSection from '@/components/helpdesk/settings/HelpdeskTeamsSection.vue'
import HelpdeskValueListSection from '@/components/helpdesk/settings/HelpdeskValueListSection.vue'

// The Support Desk settings under Settings > Applications: the policy card, support teams, workflow stages, value lists
// and service levels. Reading needs `helpdesk.settings.read`, saving `helpdesk.settings.manage`.
const { t } = useI18n()
const { parts } = useSettingsPage('helpdesk')
const { can } = useAccess()
const canRead = () => can('helpdesk.settings.read')
const settings = useHelpdeskSettings(canRead)
const resources = useHelpdeskResources(canRead)
const sla = useHelpdeskSla(canRead)
const canManage = computed(() => can('helpdesk.settings.manage'))
const activeStages = computed(() => (resources.data.value?.stages ?? []).filter(row => row.active))
const activeTeams = computed(() => (resources.data.value?.teams ?? []).filter(row => row.active))

async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('helpdesk.title')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <SharedSettingsSection v-if="settings.data.value" id="policy" :title="t('helpdesk.settings.policy')" :description="t('helpdesk.settings.policyHint')">
          <HelpdeskPolicyCard
            :settings="settings.data.value"
            :stages="activeStages"
            :teams="activeTeams"
            :can-edit="canManage"
            :reload-settings="reloadSettings"
          />
        </SharedSettingsSection>
        <template v-if="resources.data.value">
          <SharedSettingsSection id="teams" :title="t('helpdesk.settings.teams.section')" :description="t('helpdesk.settings.teams.sectionHint')">
            <HelpdeskTeamsSection :rows="resources.data.value.teams" :can-edit="canManage" />
          </SharedSettingsSection>
          <SharedSettingsSection id="workflow" :title="t('helpdesk.settings.values.section')" :description="t('helpdesk.settings.values.sectionHint')">
            <HelpdeskStagesSection :rows="resources.data.value.stages" :teams="resources.data.value.teams" :can-edit="canManage" />
            <HelpdeskValueListSection kind="categories" :rows="resources.data.value.categories" :can-edit="canManage" />
            <HelpdeskValueListSection kind="tags" :rows="resources.data.value.tags" :can-edit="canManage" />
            <HelpdeskValueListSection kind="channels" :rows="resources.data.value.channels" :can-edit="canManage" />
            <HelpdeskValueListSection kind="types" :rows="resources.data.value.types" :can-edit="canManage" />
          </SharedSettingsSection>
          <SharedSettingsSection v-if="sla.data.value" id="sla" :title="t('helpdesk.settings.sla.section')" :description="t('helpdesk.settings.sla.sectionHint')">
            <HelpdeskSlaSection
              :rows="sla.data.value.items"
              :stages="resources.data.value.stages"
              :teams="resources.data.value.teams"
              :categories="resources.data.value.categories"
              :tags="resources.data.value.tags"
              :can-edit="canManage"
            />
          </SharedSettingsSection>
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
