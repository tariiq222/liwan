<script setup lang="ts">
import type { HelpdeskTeamResource } from '@liwan/contracts'
import type { PickedPerson } from '@/components/shared/form/PersonPicker.vue'
import { useSaveHelpdeskResource } from '@/composables/helpdesk/useHelpdeskResources'
import { saveErrorMessage } from '@/utils/formFeedback'

// Form for creating a support team or editing an existing one: name, members and the leader among them.
const props = defineProps<{ team?: HelpdeskTeamResource }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const save = useSaveHelpdeskResource('teams')

const name = ref(props.team?.name ?? '')
const memberIds = ref<number[]>(props.team ? props.team.member_ids.map(member => member.id) : [])
const leaderId = ref<number | null>(props.team?.leader_id ?? null)
const known = ref<PickedPerson[]>(props.team ? [...props.team.member_ids] : [])
const baseline = { name: name.value, memberIds: [...memberIds.value], leaderId: leaderId.value }
const submitted = ref(false)
const failure = ref<unknown>(null)

const memberOptions = computed<PickedPerson[]>(() => memberIds.value.map(id => known.value.find(person => person.id === id) ?? { id, name: `#${id}` }))
const valid = computed(() => name.value.trim() !== '')
const dirty = computed(() => !submitted.value && (
  name.value !== baseline.name
  || leaderId.value !== baseline.leaderId
  || JSON.stringify(memberIds.value) !== JSON.stringify(baseline.memberIds)
))
const disabled = computed(() => !hydrated.value || save.isPending.value)

function onMembersChange(value: number | number[] | null) {
  const next = Array.isArray(value) ? value : []
  memberIds.value = next
  if (leaderId.value !== null && !next.includes(leaderId.value)) leaderId.value = null
}

function onMembersResolved(people: PickedPerson[]) {
  const map = new Map(known.value.map(person => [person.id, person]))
  for (const person of people) map.set(person.id, person)
  known.value = [...map.values()]
}

async function submit() {
  if (disabled.value || !valid.value) return
  failure.value = null
  try {
    await save.mutateAsync({
      ...(props.team ? { id: props.team.id } : {}),
      name: name.value.trim(),
      member_ids: memberIds.value,
      leader_id: leaderId.value,
    })
    submitted.value = true
    emit('done')
  } catch (cause) {
    failure.value = cause
  }
}
</script>

<template>
  <UForm :state="{ name }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="helpdesk-team-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      :title="t('app.saveFailed')"
      :description="saveErrorMessage(failure, t('helpdesk.settings.resources.failed'), t('errors.saveUncertain'))"
      data-testid="helpdesk-team-error"
    />
    <div class="liwan-auto-grid">
      <UFormField :label="t('helpdesk.settings.resources.name')" name="helpdesk-team-name" required>
        <UInput id="helpdesk-team-name" v-model="name" class="w-full" :maxlength="64" :disabled="disabled" required data-testid="helpdesk-team-name" />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.teams.members')" name="helpdesk-team-members">
        <SharedPersonPicker
          id="helpdesk-team-members"
          :model-value="memberIds"
          multiple
          :known="known"
          :disabled="disabled"
          :aria-label="t('helpdesk.settings.teams.members')"
          @update:model-value="onMembersChange"
          @resolve="onMembersResolved"
        />
      </UFormField>
      <UFormField :label="t('helpdesk.settings.teams.leader')" name="helpdesk-team-leader">
        <SharedPersonPicker
          id="helpdesk-team-leader"
          :model-value="leaderId"
          :known="memberOptions"
          :options="memberOptions"
          :disabled="disabled"
          :aria-label="t('helpdesk.settings.teams.leader')"
          @update:model-value="value => { leaderId = typeof value === 'number' ? value : null }"
        />
      </UFormField>
    </div>
    <SharedFormActions>
      <div class="ms-auto flex items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="save.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="disabled || !valid" :loading="save.isPending.value" :label="team ? t('app.saveChanges') : t('app.create')" data-testid="helpdesk-team-save" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
