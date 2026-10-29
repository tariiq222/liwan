<script setup lang="ts">
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

// The CRM application's settings, one page of cards under Settings > Applications. Reading needs `crm.settings.read`,
// changing anything `crm.settings.manage`. Each value card saves only its own fields with the revision it was made from;
// the five lists save row by row through their own routes.
const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('crm')
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
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('nav.crm')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <CrmPresetCard v-if="shows('preset')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <CrmTermsCard v-if="shows('terms')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <CrmFollowupCard v-if="shows('followup')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <CrmDistributionCard v-if="shows('distribution')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <CrmPrivacyCard v-if="shows('privacy')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          <CrmPricingCard v-if="shows('pricing')" :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
        </template>
      </SharedPageState>
      <CrmPackageListCard v-if="shows('packages')" :can-edit="canManage" />
      <CrmStageListCard v-if="shows('stages')" :can-edit="canManage" />
      <CrmOutcomeListCard v-if="shows('outcomes')" :can-edit="canManage" />
      <CrmNamedListCard v-if="shows('lostReasons')" kind="lost-reasons" :title="t('crm.settings.lostReasons.title')" :hint="t('crm.settings.lostReasons.hint')" :can-edit="canManage" />
      <CrmNamedListCard v-if="shows('sources')" kind="sources" :title="t('crm.settings.sources.title')" :hint="t('crm.settings.sources.hint')" :can-edit="canManage" />
    </template>
  </SharedSettingsPage>
</template>
