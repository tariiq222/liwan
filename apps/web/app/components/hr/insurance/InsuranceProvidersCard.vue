<script setup lang="ts">
import type { HrInsuranceProvider } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'

// The insurers manager of the HR settings and of the Providers section of /hr/insurance: rename, archive and
// restore, and add a provider. A row edit saves with the revision it started from, so a concurrent change
// answers 409 even after a background refetch; a 409 locks the card until the list is reloaded.
const props = defineProps<{ providers: HrInsuranceProvider[]; canEdit: boolean; reloadProviders: () => Promise<unknown> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateHrInsuranceProvider()
const patch = usePatchHrInsuranceProvider()

type Draft = { name: string; revision: number }
const drafts = ref<Record<number, Draft>>({})
const newName = ref('')
const attempted = ref(false)
const savingId = ref<number | null>(null)
const failure = ref<unknown>(null)
const reloading = ref(false)

const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const busy = computed(() => !props.canEdit || create.isPending.value || savingId.value !== null || reloading.value || conflict.value)
const message = computed(() => failure.value ? (conflict.value ? t('hrInsurance.providers.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')
const nameError = computed(() => attempted.value && !newName.value.trim() ? t('hrInsurance.providers.nameRequired') : undefined)

function draft(provider: HrInsuranceProvider) {
  return drafts.value[provider.id] ?? { name: provider.name, revision: provider.revision }
}
function setName(provider: HrInsuranceProvider, name: string) {
  drafts.value = { ...drafts.value, [provider.id]: { ...draft(provider), name } }
}
function changed(provider: HrInsuranceProvider) {
  return draft(provider).name !== provider.name
}
function savable(provider: HrInsuranceProvider) {
  return changed(provider) && !!draft(provider).name.trim()
}

async function run(id: number | null, action: () => Promise<unknown>) {
  if (!hydrated.value || busy.value) return
  failure.value = null
  savingId.value = id
  try {
    await action()
  } catch (error) { failure.value = error } finally { savingId.value = null }
}
async function saveName(provider: HrInsuranceProvider) {
  const current = draft(provider)
  if (!savable(provider)) return
  await run(provider.id, async () => {
    await patch.mutateAsync({ id: provider.id, body: { revision: current.revision, name: current.name.trim() } })
    const { [provider.id]: _saved, ...rest } = drafts.value
    drafts.value = rest
  })
}
async function setActive(provider: HrInsuranceProvider, active: boolean) {
  await run(provider.id, () => patch.mutateAsync({ id: provider.id, body: { revision: provider.revision, active } }))
}
async function addProvider() {
  attempted.value = true
  if (!newName.value.trim()) return
  await run(null, async () => {
    await create.mutateAsync({ name: newName.value.trim() })
    newName.value = ''
    attempted.value = false
  })
}
async function reload() {
  if (reloading.value) return
  reloading.value = true
  try {
    await props.reloadProviders()
    drafts.value = {}
    failure.value = null
  } catch (error) { failure.value = error } finally { reloading.value = false }
}
</script>

<template>
  <SharedFormSection panel :title="t('hrInsurance.providers.title')" :description="t('hrInsurance.providers.hint')">
    <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('hrInsurance.providers.saveError')" :description="message" data-testid="hr-insurance-providers-error" />
    <UButton v-if="conflict" color="neutral" variant="outline" :label="t('hrInsurance.providers.reload')" :loading="reloading" :disabled="reloading" data-testid="hr-insurance-providers-reload" @click="reload" />
    <SharedEmptyState v-if="!props.providers.length" :title="t('hrInsurance.providers.emptyTitle')" :description="t('hrInsurance.providers.emptyHint')" />
    <ul v-else class="grid gap-4" data-testid="hr-insurance-providers">
      <li v-for="provider in props.providers" :key="provider.id" class="grid items-end gap-3 sm:grid-cols-[1fr_13rem]" :data-testid="`hr-insurance-provider-${provider.id}`">
        <UFormField :label="t('hrInsurance.providers.name')" :name="`hr-insurance-provider-name-${provider.id}`">
          <UInput :id="`hr-insurance-provider-name-${provider.id}`" class="w-full" :model-value="draft(provider).name" :disabled="!hydrated || busy" @update:model-value="setName(provider, String($event ?? ''))" />
        </UFormField>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <SharedStatusBadge v-if="!provider.active" size="sm" tone="neutral" :label="t('hrInsurance.providers.archived')" />
          <UButton v-if="changed(provider)" color="primary" :disabled="!hydrated || busy || !savable(provider)" :loading="savingId === provider.id" :label="t('hrInsurance.providers.save')" data-testid="hr-insurance-provider-save" @click="saveName(provider)" />
          <UButton v-if="props.canEdit" color="neutral" variant="outline" :disabled="!hydrated || busy" :label="provider.active ? t('hrInsurance.providers.archive') : t('hrInsurance.providers.restore')" data-testid="hr-insurance-provider-toggle" @click="setActive(provider, !provider.active)" />
        </div>
      </li>
    </ul>
    <form v-if="props.canEdit" class="mt-3 grid items-end gap-3 border-t border-default pt-4 sm:grid-cols-[1fr_13rem]" data-testid="hr-insurance-provider-add" @submit.prevent="addProvider">
      <UFormField :label="t('hrInsurance.providers.name')" name="hr-insurance-provider-new-name" :error="nameError">
        <UInput id="hr-insurance-provider-new-name" v-model="newName" class="w-full" :placeholder="t('hrInsurance.providers.namePlaceholder')" :disabled="!hydrated || busy" />
      </UFormField>
      <UButton type="submit" color="primary" :disabled="!hydrated || busy" :loading="create.isPending.value" :label="t('hrInsurance.providers.add')" data-testid="hr-insurance-provider-add-submit" />
    </form>
  </SharedFormSection>
</template>
