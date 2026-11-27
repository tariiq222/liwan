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

const revisions = ref<Record<number, number>>({})
const newName = ref('')
const savingId = ref<number | null>(null)
const failure = ref<unknown>(null)
const reloading = ref(false)
const reloadGeneration = ref(0)

const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
const busy = computed(() => create.isPending.value || savingId.value !== null || reloading.value || conflict.value)
const locked = computed(() => !hydrated.value || !props.canEdit || busy.value)
const message = computed(() => failure.value ? (conflict.value ? t('hrInsurance.providers.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))) : '')

function captureRevision(provider: HrInsuranceProvider) {
  if (revisions.value[provider.id] === undefined) {
    revisions.value = { ...revisions.value, [provider.id]: provider.revision }
  }
}
function clearRevision(id: number) {
  if (revisions.value[id] === undefined) return
  const { [id]: _cleared, ...rest } = revisions.value
  revisions.value = rest
}
function releaseRevision(id: number, event?: FocusEvent) {
  if (event?.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  if (savingId.value !== id && !conflict.value) clearRevision(id)
}

async function run(id: number | null, action: () => Promise<unknown>) {
  if (locked.value) return
  failure.value = null
  savingId.value = id
  try {
    await action()
  } catch (error) { failure.value = error } finally { savingId.value = null }
}
async function saveName(provider: HrInsuranceProvider, name: string) {
  const trimmed = name.trim()
  if (!trimmed || trimmed === provider.name) return
  const revision = revisions.value[provider.id] ?? provider.revision
  await run(provider.id, async () => {
    await patch.mutateAsync({ id: provider.id, body: { revision, name: trimmed } })
    clearRevision(provider.id)
  })
}
async function setActive(provider: HrInsuranceProvider, active: boolean) {
  await run(provider.id, async () => {
    await patch.mutateAsync({ id: provider.id, body: { revision: provider.revision, active } })
    clearRevision(provider.id)
  })
}
async function addProvider() {
  const name = newName.value.trim()
  if (!name) return
  await run(null, async () => {
    await create.mutateAsync({ name })
    newName.value = ''
  })
}
async function reload() {
  if (reloading.value) return
  reloading.value = true
  try {
    await props.reloadProviders()
    revisions.value = {}
    failure.value = null
    reloadGeneration.value += 1
  } catch (error) { failure.value = error } finally { reloading.value = false }
}
</script>

<template>
  <SharedSettingsList
    id="insurance-providers"
    data-testid="hr-insurance-providers"
    :title="t('hrInsurance.providers.title')"
    :description="t('hrInsurance.providers.hint')"
    :can-edit="canEdit"
    :message="message"
    :empty="!props.providers.length"
    :adding="create.isPending.value"
    :add-disabled="busy || !newName.trim()"
    @add="addProvider"
  >
    <template v-if="conflict" #before>
      <UButton
        class="justify-self-start"
        color="neutral"
        variant="outline"
        :label="t('hrInsurance.providers.reload')"
        :loading="reloading"
        :disabled="!hydrated || reloading"
        data-testid="hr-insurance-providers-reload"
        @click="reload"
      />
    </template>
    <SharedSettingsListRow
      v-for="provider in props.providers"
      :key="`${provider.id}-${reloadGeneration}`"
      :name="provider.name"
      :active="provider.active"
      :can-edit="canEdit"
      :busy="busy"
      :data-testid="`hr-insurance-provider-${provider.id}`"
      @focusin="captureRevision(provider)"
      @focusout="releaseRevision(provider.id, $event)"
      @rename="name => saveName(provider, name)"
      @toggle="active => setActive(provider, active)"
    />
    <template #add>
      <UInput
        v-model="newName"
        class="min-w-40 flex-1"
        :placeholder="t('hrInsurance.providers.namePlaceholder')"
        :aria-label="t('hrInsurance.providers.name')"
        :maxlength="200"
        :disabled="!hydrated || busy"
      />
    </template>
  </SharedSettingsList>
</template>
