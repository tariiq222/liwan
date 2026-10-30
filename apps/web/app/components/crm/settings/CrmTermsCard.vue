<script setup lang="ts">
import type { CrmSettings } from '@liwan/contracts'
import { useCrmSettingsCard } from '@/composables/crm/useCrmSettingsCard'
import { agreeKey } from '@/utils/crmTermForms'

const props = defineProps<{ settings: CrmSettings; canEdit: boolean; reloadSettings: () => Promise<CrmSettings> }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useCrmSettingsCard({
  settings: () => props.settings,
  read: ({ terms }) => ({ terms }),
  toPatch: ({ terms }) => ({ values: { terms } }),
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const genders = computed(() => [
  { value: 'm', label: t('crm.settings.terms.masculine') },
  { value: 'f', label: t('crm.settings.terms.feminine') },
])
const groups = computed(() => [
  { key: 'customer', label: t('crm.settings.terms.customer') },
  { key: 'opportunity', label: t('crm.settings.terms.opportunity') },
  { key: 'package', label: t('crm.settings.terms.package') },
] as const)
// The agreement the renamed word gets in the UI language, shown beside the fields so the manager sees the effect.
const preview = (key: 'customer' | 'opportunity' | 'package') => {
  const term = draft.value.terms[key]
  const word = term[locale.value === 'en' ? 'en' : 'ar'].singular
  return t(agreeKey('crm.settings.terms.preview', term.gender), { term: word })
}
</script>

<template>
  <SharedSettingsCard id="terms" v-bind="state" :title="t('crm.settings.terms.title')" :description="t('crm.settings.terms.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <fieldset v-for="group in groups" :key="group.key" class="grid gap-3 not-first:border-t not-first:border-default not-first:pt-4 sm:grid-cols-2">
      <legend class="mb-2 text-sm font-medium text-highlighted">{{ group.label }}</legend>
      <UFormField :label="t('crm.settings.terms.arSingular')" :name="`${group.key}-ar-singular`">
        <UInput :id="`${group.key}-ar-singular`" v-model="draft.terms[group.key].ar.singular" class="w-full" :maxlength="60" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('crm.settings.terms.arPlural')" :name="`${group.key}-ar-plural`">
        <UInput :id="`${group.key}-ar-plural`" v-model="draft.terms[group.key].ar.plural" class="w-full" :maxlength="60" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('crm.settings.terms.enSingular')" :name="`${group.key}-en-singular`">
        <UInput :id="`${group.key}-en-singular`" v-model="draft.terms[group.key].en.singular" class="w-full" dir="ltr" :maxlength="60" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('crm.settings.terms.enPlural')" :name="`${group.key}-en-plural`">
        <UInput :id="`${group.key}-en-plural`" v-model="draft.terms[group.key].en.plural" class="w-full" dir="ltr" :maxlength="60" :disabled="locked" />
      </UFormField>
      <UFormField :label="t('crm.settings.terms.gender')" :name="`${group.key}-gender`" :help="t('crm.settings.terms.genderHint')">
        <USelect :id="`${group.key}-gender`" v-model="draft.terms[group.key].gender" class="w-full" :items="genders" :disabled="locked" />
      </UFormField>
      <p class="self-end pb-2 text-sm text-muted">{{ t('crm.settings.terms.previewLabel') }}: <span class="font-medium text-default">{{ preview(group.key) }}</span></p>
    </fieldset>
  </SharedSettingsCard>
</template>
