<script setup lang="ts">
import CrmCustomFieldsCard from '@/components/crm/settings/CrmCustomFieldsCard.vue'
import CrmDistributionCard from '@/components/crm/settings/CrmDistributionCard.vue'
import CrmFollowupCard from '@/components/crm/settings/CrmFollowupCard.vue'
import CrmNamedListCard from '@/components/crm/settings/CrmNamedListCard.vue'
import CrmOutcomeListCard from '@/components/crm/settings/CrmOutcomeListCard.vue'
import CrmPackageListCard from '@/components/crm/settings/CrmPackageListCard.vue'
import CrmPresetCard from '@/components/crm/settings/CrmPresetCard.vue'
import CrmPricingCard from '@/components/crm/settings/CrmPricingCard.vue'
import CrmPrivacyCard from '@/components/crm/settings/CrmPrivacyCard.vue'
import CrmStageListCard from '@/components/crm/settings/CrmStageListCard.vue'
import CrmTermsCard from '@/components/crm/settings/CrmTermsCard.vue'
import { useCrmSettings } from '@/composables/crm/useCrmSettings'

// The CRM application's settings under Settings > Applications: the preset card, then one tab per manifest group.
// Reading needs `crm.settings.read`, changing anything `crm.settings.manage`. Each value card saves only its own fields
// with the revision it was made from, through the page's one save bar; the five lists save row by row. Hidden tabs stay
// mounted (v-show), so an unsaved draft survives a tab switch.
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows, tabItems, activeTab } = useSettingsPage('crm')
const settings = useCrmSettings()
const canManage = computed(() => can('crm.settings.manage'))
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage>
    <SharedPageHeader :title="t('nav.crm')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <CrmPresetCard v-if="shows('preset')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <SharedRouteTabs :items="tabItems" :ariaLabel="t('crm.settings.groups.label')" />
          <div v-show="activeTab === 'basics'" class="grid gap-4" data-testid="settings-panel-basics">
            <CrmTermsCard v-if="shows('terms')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
            <CrmCustomFieldsCard v-if="shows('customFields')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </div>
          <div v-show="activeTab === 'workflow'" class="grid gap-4" data-testid="settings-panel-workflow">
            <div class="grid items-start gap-4 lg:grid-cols-2">
              <CrmFollowupCard v-if="shows('followup')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
              <CrmDistributionCard v-if="shows('distribution')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
            </div>
            <CrmStageListCard v-if="shows('stages')" :can-edit="canManage" />
            <div class="grid items-start gap-4 xl:grid-cols-3">
              <CrmOutcomeListCard v-if="shows('outcomes')" :can-edit="canManage" />
              <CrmNamedListCard v-if="shows('lostReasons')" kind="lost-reasons" :title="t('crm.settings.lostReasons.title')" :hint="t('crm.settings.lostReasons.hint')" :can-edit="canManage" />
              <CrmNamedListCard v-if="shows('sources')" kind="sources" :title="t('crm.settings.sources.title')" :hint="t('crm.settings.sources.hint')" :can-edit="canManage" />
            </div>
          </div>
          <div v-show="activeTab === 'sales'" class="grid gap-4" data-testid="settings-panel-sales">
            <CrmPricingCard v-if="shows('pricing')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
            <CrmPackageListCard v-if="shows('packages')" :can-edit="canManage" />
          </div>
          <div v-show="activeTab === 'privacy'" class="grid gap-4" data-testid="settings-panel-privacy">
            <CrmPrivacyCard v-if="shows('privacy')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </div>
        </template>
      </SharedPageState>
    </template>
  </SharedSettingsPage>
</template>
