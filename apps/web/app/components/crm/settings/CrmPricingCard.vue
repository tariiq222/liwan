<script setup lang="ts">
import type { CrmSettings } from '@webvue/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ discount_allowed, discount_max_percent }) => ({ discount_allowed, discount_max_percent }),
  toPatch: values => ({ values }),
  reload: () => props.reloadSettings(),
})
const range = computed(() => props.settings.options.discount_max_percent)
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="pricing" v-bind="state" :title="t('crm.settings.pricing.title')" :description="t('crm.settings.pricing.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <UFormField orientation="horizontal" :label="t('crm.settings.pricing.discountAllowed')" :description="t('crm.settings.pricing.discountAllowedHint')">
      <USwitch v-model="draft.discount_allowed" :disabled="locked" :aria-label="t('crm.settings.pricing.discountAllowed')" />
    </UFormField>
    <UFormField orientation="horizontal" v-if="draft.discount_allowed" :label="t('crm.settings.pricing.discountMax')" name="discount-max" :description="t('crm.settings.pricing.discountMaxHint')">
      <UInputNumber id="discount-max" v-model="draft.discount_max_percent" class="w-full" :min="range.min" :max="range.max" :disabled="locked" />
    </UFormField>
  </SharedSettingsCard>
</template>
