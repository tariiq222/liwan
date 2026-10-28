<script setup lang="ts">
import type { CrmPreset, CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, shell, save, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ preset }) => ({ preset }),
  toPatch: ({ preset }) => ({ preset }),
  reload: () => props.reloadSettings(),
})
const confirming = ref(false)
const locked = computed(() => !hydrated.value || !props.canEdit || shell.value.saving || shell.value.reloading)
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
  <CrmSettingsCard v-bind="shell" :title="t('crm.settings.preset.title')" :description="t('crm.settings.preset.hint')" :can-edit="canEdit" :save-label="t('crm.settings.preset.apply')" @save="confirming = true" @reload="reload">
    <UFormField :label="t('crm.settings.preset.choose')" name="crm-preset" :help="labels[draft.preset].hint">
      <USelect id="crm-preset" v-model="draft.preset" class="w-full" :items="items" :disabled="locked" />
    </UFormField>
    <SharedInlineConfirm
      v-if="confirming && shell.dirty"
      color="warning"
      :title="t('crm.settings.preset.confirmTitle', { name: labels[draft.preset].label })"
      :description="t('crm.settings.preset.confirmBody')"
      :confirm-label="t('crm.settings.preset.apply')"
      :pending="shell.saving"
      @cancel="confirming = false"
      @confirm="apply"
    />
  </CrmSettingsCard>
</template>
