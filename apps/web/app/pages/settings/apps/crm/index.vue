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
  <SharedSettingsPage width="list">
    <SharedPageHeader :title="t('nav.crm')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch">
        <template v-if="settings.data.value">
          <section v-if="shows('preset')" id="preset" class="webvue-settings-anchor">
            <CrmPresetCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
          <section v-if="shows('terms')" id="terms" class="webvue-settings-anchor">
            <CrmTermsCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
          <section v-if="shows('followup')" id="followup" class="webvue-settings-anchor">
            <CrmFollowupCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
          <section v-if="shows('distribution')" id="distribution" class="webvue-settings-anchor">
            <CrmDistributionCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
          <section v-if="shows('privacy')" id="privacy" class="webvue-settings-anchor">
            <CrmPrivacyCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
          <section v-if="shows('pricing')" id="pricing" class="webvue-settings-anchor">
            <CrmPricingCard :settings="settings.data.value" :can-edit="canManage" :reload-settings="reloadSettings" />
          </section>
        </template>
      </SharedPageState>
      <section v-if="shows('packages')" id="packages" class="webvue-settings-anchor"><CrmPackageListCard :can-edit="canManage" /></section>
      <section v-if="shows('stages')" id="stages" class="webvue-settings-anchor"><CrmStageListCard :can-edit="canManage" /></section>
      <section v-if="shows('outcomes')" id="outcomes" class="webvue-settings-anchor"><CrmOutcomeListCard :can-edit="canManage" /></section>
      <section v-if="shows('lostReasons')" id="lostReasons" class="webvue-settings-anchor">
        <CrmNamedListCard kind="lost-reasons" :title="t('crm.settings.lostReasons.title')" :hint="t('crm.settings.lostReasons.hint')" :can-edit="canManage" />
      </section>
      <section v-if="shows('sources')" id="sources" class="webvue-settings-anchor">
        <CrmNamedListCard kind="sources" :title="t('crm.settings.sources.title')" :hint="t('crm.settings.sources.hint')" :can-edit="canManage" />
      </section>
    </template>
  </SharedSettingsPage>
</template>
