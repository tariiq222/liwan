<script setup lang="ts">
import type { ProjectStakeholder, ProjectStakeholderWrite } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useCreateProjectStakeholder, useUpdateProjectStakeholder } from '@/composables/useProjectGovernance'

const props = defineProps<{ projectId: number; stakeholder?: ProjectStakeholder }>()
const emit = defineEmits<{ saved: [item: ProjectStakeholder]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref(props.stakeholder?.name ?? '')
const organization = ref(props.stakeholder?.organization ?? '')
const role = ref(props.stakeholder?.role ?? '')
const contact = ref(props.stakeholder?.contact ?? '')
const notes = ref(props.stakeholder?.notes ?? '')
const userId = ref<number | null>(props.stakeholder?.user?.id ?? null)
const userQuery = ref('')
const people = usePeople(userQuery)
const peopleOptions = computed(() => {
  const current = props.stakeholder?.user
  const options = people.data.value?.map(user => ({ id: user.id, name: user.name })) ?? []
  if (current && !options.some(user => user.id === current.id)) options.unshift(current)
  return options
})
const userItems = computed(() => [
  { value: 'none', label: t('projects.governance.stakeholder.noInternalUser') },
  ...peopleOptions.value.map(user => ({ value: String(user.id), label: user.name })),
])
const userSelect = computed({
  get: () => userId.value == null ? 'none' : String(userId.value),
  set: (value: string) => { userId.value = value === 'none' ? null : Number(value) },
})
const baseline = JSON.stringify([name.value, organization.value, role.value, contact.value, notes.value, userId.value])
const submitted = ref(false)
const attempted = ref(false)
const requiredError = computed(() => attempted.value && !name.value.trim() ? t('projects.governance.stakeholder.nameRequired') : undefined)
const error = ref<string | null>(null)
const dirty = computed(() => !submitted.value && JSON.stringify([name.value, organization.value, role.value, contact.value, notes.value, userId.value]) !== baseline)
const create = useCreateProjectStakeholder()
const update = useUpdateProjectStakeholder()
const pending = computed(() => create.isPending.value || update.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = null
  if (!name.value.trim()) return
  const body: ProjectStakeholderWrite = {
    name: name.value.trim(),
    user_id: userId.value,
    organization: organization.value,
    role: role.value,
    contact: contact.value,
    notes: notes.value,
  }
  try {
    const item = props.stakeholder
      ? await update.mutateAsync({ projectId: props.projectId, id: props.stakeholder.id, body })
      : await create.mutateAsync({ projectId: props.projectId, body })
    submitted.value = true
    await nextTick()
    emit('saved', item)
  }
  catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form novalidate class="liwan-page-stack" @submit.prevent="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('projects.refresh.workspace.stakeholderIdentity')" :description="t('projects.refresh.workspace.stakeholderIdentityDescription')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('projects.governance.stakeholder.name')" required :error="requiredError">
          <UInput id="stakeholder-name" v-model="name" class="w-full" required :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.governance.stakeholder.organization')">
          <UInput id="stakeholder-organization" v-model="organization" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.governance.stakeholder.role')">
          <UInput id="stakeholder-role" v-model="role" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('projects.refresh.workspace.stakeholderConnection')" :description="t('projects.refresh.workspace.stakeholderConnectionDescription')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('projects.governance.stakeholder.contact')">
          <UInput id="stakeholder-contact" v-model="contact" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.governance.stakeholder.internalUser')">
          <div class="grid gap-2">
            <UInput id="stakeholder-user-search" v-model="userQuery" class="w-full" :placeholder="t('app.search')" :disabled="!hydrated || pending" />
            <USelect
              id="stakeholder-user"
              v-model="userSelect"
              :items="userItems"
              class="w-full"
              :aria-label="t('projects.governance.stakeholder.internalUser')"
              :disabled="!hydrated || pending || people.isLoading.value"
            />
            <p v-if="people.isLoading.value" role="status" class="text-xs text-muted">{{ t('projects.loading') }}</p>
            <p v-else-if="people.error.value" role="alert" class="text-xs text-error">{{ t('projects.loadError') }}</p>
            <p v-else-if="!peopleOptions.length" class="text-xs text-muted">{{ t('projects.governance.stakeholder.noUsers') }}</p>
          </div>
        </UFormField>
        <UFormField :label="t('projects.governance.stakeholder.notes')">
          <UTextarea id="stakeholder-notes" v-model="notes" class="w-full" :rows="4" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <p class="me-auto text-xs text-muted">{{ t('projects.requiredHint') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || pending" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
        <UButton type="submit" :disabled="!hydrated || pending" :loading="pending">{{ pending ? t('projects.governance.saving') : t('app.save') }}</UButton>
      </div>
    </SharedFormActions>
  </form>
</template>
