<script setup lang="ts">
import { useCreateResolution, useMeeting } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = useCreateResolution()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${id.value}`, ['/meetings']))
const name = ref('')
const responsibleId = ref<number | ''>('')
const deadline = ref('')
const priority = ref<'0' | '1' | '2' | '3'>('0')
function snapshot() {
  return JSON.stringify([name.value, responsibleId.value, deadline.value, priority.value])
}
const baseline = ref(snapshot())
const dirty = computed(() => snapshot() !== baseline.value)

async function save() {
  if (!hydrated.value || !name.value.trim() || !responsibleId.value || !deadline.value) return
  await mutateAsync({
    meetingId: id.value,
    body: { name: name.value.trim(), responsible_id: Number(responsibleId.value), deadline: deadline.value, priority: priority.value },
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUi.newResolution')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
    <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
      <SharedUnsavedChanges :dirty="dirty" />
      <Label for="res-name">{{ t('meetingsUi.title') }}</Label>
      <Input id="res-name" v-model="name" :disabled="!hydrated || isPending" required />
      <Label for="res-user">{{ t('meetingsUi.responsible') }}</Label>
      <select id="res-user" v-model="responsibleId" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending" required>
        <option value="">{{ t('meetingsUi.responsible') }}</option>
        <option v-for="person in [query.data.value.organizer, query.data.value.secretary, ...query.data.value.attendees].filter(Boolean)" :key="person!.id" :value="person!.id">{{ person!.name }}</option>
      </select>
      <Label for="res-deadline">{{ t('meetingsUi.deadline') }}</Label>
      <Input id="res-deadline" v-model="deadline" type="date" :disabled="!hydrated || isPending" required />
      <Label for="res-priority">{{ t('meetingsUi.priority') }}</Label>
      <select id="res-priority" v-model="priority" class="border-input h-9 rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated || isPending">
        <option v-for="code in ['0', '1', '2', '3']" :key="code" :value="code">{{ t(`meetingsUi.priorityLabel.${code}`) }}</option>
      </select>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error.message }}</p>
      <div class="flex justify-end gap-2">
        <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
        <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
      </div>
    </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
