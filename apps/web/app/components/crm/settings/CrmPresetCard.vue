<script setup lang="ts">
import type { CrmPreset, CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ preset }) => ({ preset }),
  toPatch: ({ preset }) => ({ preset }),
  reload: () => props.reloadSettings(),
})
const confirming = ref(false)
// Choosing the current preset again (or a reload) leaves nothing to confirm.
watch(() => state.value.dirty, dirty => { if (!dirty) confirming.value = false })
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const labels = computed<Record<CrmPreset, { label: string; hint: string }>>(() => ({
  general: { label: t('crm.settings.preset.general'), hint: t('crm.settings.preset.generalHint') },
  phone_packages: { label: t('crm.settings.preset.phonePackages'), hint: t('crm.settings.preset.phonePackagesHint') },
}))
const items = computed(() => props.settings.options.preset.map(value => ({ value, label: labels.value[value].label })))
async function apply() {
  await save()
  confirming.value = false
}
</script>

<template>
  <SharedSettingsCard id="preset" v-bind="state" :title="t('crm.settings.preset.title')" :description="t('crm.settings.preset.hint')" :can-edit="canEdit" :save-label="t('crm.settings.preset.apply')" @save="confirming = true" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.preset.choose')" name="crm-preset" :description="labels[draft.preset].hint">
      <USelect id="crm-preset" v-model="draft.preset" class="w-full" :items="items" :disabled="locked" />
    </UFormField>
    <SharedInlineConfirm
      v-if="confirming && state.dirty"
      color="warning"
      :title="t('crm.settings.preset.confirmTitle', { name: labels[draft.preset].label })"
      :description="t('crm.settings.preset.confirmBody')"
      :confirm-label="t('crm.settings.preset.apply')"
      :pending="state.saving"
      @cancel="confirming = false"
      @confirm="apply"
    />
  </SharedSettingsCard>
</template>
