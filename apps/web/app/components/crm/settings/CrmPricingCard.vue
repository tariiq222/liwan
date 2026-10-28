<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, shell, save, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ discount_allowed, discount_max_percent }) => ({ discount_allowed, discount_max_percent }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const range = computed(() => props.settings.options.discount_max_percent)
const locked = computed(() => !hydrated.value || !props.canEdit || shell.value.saving || shell.value.reloading)
</script>

<template>
  <CrmSettingsCard v-bind="shell" :title="t('crm.settings.pricing.title')" :description="t('crm.settings.pricing.hint')" :can-edit="canEdit" @save="save" @reload="reload">
    <USwitch v-model="draft.discount_allowed" :label="t('crm.settings.pricing.discountAllowed')" :description="t('crm.settings.pricing.discountAllowedHint')" :disabled="locked" />
    <UFormField v-if="draft.discount_allowed" :label="t('crm.settings.pricing.discountMax')" name="discount-max" :help="t('crm.settings.pricing.discountMaxHint')">
      <UInputNumber id="discount-max" v-model="draft.discount_max_percent" class="w-full" :min="range.min" :max="range.max" :disabled="locked" />
    </UFormField>
  </CrmSettingsCard>
</template>
