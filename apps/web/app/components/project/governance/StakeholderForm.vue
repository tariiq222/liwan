<script setup lang="ts">
import type { ProjectStakeholder, ProjectStakeholderWrite } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { usePeople } from '@/composables/usePeople'
import { useCreateProjectStakeholder, useUpdateProjectStakeholder } from '@/composables/useProjectGovernance'

const props = defineProps<{ projectId: number; stakeholder?: ProjectStakeholder }>()
const emit = defineEmits<{ saved: [item: ProjectStakeholder]; cancel: [] }>()
const { t } = useI18n(); const hydrated = useHydrated()
const name = ref(props.stakeholder?.name ?? ''); const organization = ref(props.stakeholder?.organization ?? '')
const role = ref(props.stakeholder?.role ?? ''); const contact = ref(props.stakeholder?.contact ?? ''); const notes = ref(props.stakeholder?.notes ?? '')
const userId = ref<number | null>(props.stakeholder?.user?.id ?? null)
const userQuery = ref('')
const people = usePeople(userQuery)
const peopleOptions = computed(() => {
  const current = props.stakeholder?.user
  const options = people.data.value?.map(user => ({ id: user.id, name: user.name })) ?? []
  if (current && !options.some(user => user.id === current.id)) options.unshift(current)
  return options
})
const baseline = JSON.stringify([name.value, organization.value, role.value, contact.value, notes.value, userId.value]); const submitted = ref(false); const error = ref<string | null>(null)
const dirty = computed(() => !submitted.value && JSON.stringify([name.value, organization.value, role.value, contact.value, notes.value, userId.value]) !== baseline)
const create = useCreateProjectStakeholder(); const update = useUpdateProjectStakeholder(); const pending = computed(() => create.isPending.value || update.isPending.value)
async function submit() {
  error.value = null
  if (!name.value.trim()) return
  const body: ProjectStakeholderWrite = { name: name.value.trim(), user_id: userId.value, organization: organization.value, role: role.value, contact: contact.value, notes: notes.value }
  try { const item = props.stakeholder ? await update.mutateAsync({ projectId: props.projectId, id: props.stakeholder.id, body }) : await create.mutateAsync({ projectId: props.projectId, body }); submitted.value = true; await nextTick(); emit('saved', item) }
  catch (e) { error.value = e instanceof ApiError ? e.message : t('errors.generic') }
}
</script>
<template>
  <form class="space-y-8" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection :title="t('projects.refresh.workspace.stakeholderIdentity')" :description="t('projects.refresh.workspace.stakeholderIdentityDescription')">
      <div class="nasq-form-grid">
        <div class="grid gap-2"><Label for="stakeholder-name">{{ t('projects.governance.stakeholder.name') }}</Label><Input id="stakeholder-name" v-model="name" required :disabled="!hydrated || pending" /></div>
        <div class="grid gap-2"><Label for="stakeholder-organization">{{ t('projects.governance.stakeholder.organization') }}</Label><Input id="stakeholder-organization" v-model="organization" :disabled="!hydrated || pending" /></div>
        <div class="grid gap-2"><Label for="stakeholder-role">{{ t('projects.governance.stakeholder.role') }}</Label><Input id="stakeholder-role" v-model="role" :disabled="!hydrated || pending" /></div>
      </div>
    </SharedFormSection>
    <SharedFormSection :title="t('projects.refresh.workspace.stakeholderConnection')" :description="t('projects.refresh.workspace.stakeholderConnectionDescription')">
      <div class="nasq-form-grid">
        <div class="grid gap-2"><Label for="stakeholder-contact">{{ t('projects.governance.stakeholder.contact') }}</Label><Input id="stakeholder-contact" v-model="contact" :disabled="!hydrated || pending" /></div>
        <div class="grid gap-2"><Label for="stakeholder-user-search">{{ t('projects.governance.stakeholder.internalUser') }}</Label><Input id="stakeholder-user-search" v-model="userQuery" :placeholder="t('app.search')" :disabled="!hydrated || pending" /><select id="stakeholder-user" v-model="userId" :aria-label="t('projects.governance.stakeholder.internalUser')" class="nasq-input" :disabled="!hydrated || pending || people.isLoading.value"><option :value="null">{{ t('projects.governance.stakeholder.noInternalUser') }}</option><option v-for="user in peopleOptions" :key="user.id" :value="user.id">{{ user.name }}</option></select><p v-if="people.isLoading.value" role="status" class="text-xs text-muted-foreground">{{ t('projects.loading') }}</p><p v-else-if="people.error.value" role="alert" class="text-xs text-destructive">{{ t('projects.loadError') }}</p><p v-else-if="!peopleOptions.length" class="text-xs text-muted-foreground">{{ t('projects.governance.stakeholder.noUsers') }}</p></div>
        <div class="grid gap-2 sm:col-span-2"><Label for="stakeholder-notes">{{ t('projects.governance.stakeholder.notes') }}</Label><Textarea id="stakeholder-notes" v-model="notes" rows="4" :disabled="!hydrated || pending" /></div>
      </div>
    </SharedFormSection>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <div class="nasq-form-footer justify-end"><Button type="button" variant="outline" :disabled="!hydrated || pending" @click="emit('cancel')">{{ t('app.cancel') }}</Button><Button type="submit" :disabled="!hydrated || pending || !name.trim()">{{ pending ? t('projects.governance.saving') : t('app.save') }}</Button></div>
  </form>
</template>
