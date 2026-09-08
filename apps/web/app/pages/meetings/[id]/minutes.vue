<script setup lang="ts">
import DescriptionEditor from '@/components/task/DescriptionEditor.vue'
import { useMeeting, usePatchMeeting } from '@/composables/useMeetings'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const query = useMeeting(id)
const { mutateAsync, isPending, error } = usePatchMeeting()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/meetings/${id.value}`, ['/meetings']))
const agenda = ref('')
const minutes = ref('')
const loaded = ref(false)
const baseline = ref('')

function snapshot() {
  return JSON.stringify([agenda.value, minutes.value])
}

watch(query.data, meeting => {
  if (!meeting || loaded.value) return
  agenda.value = meeting.agenda
  minutes.value = meeting.minutes
  baseline.value = snapshot()
  loaded.value = true
}, { immediate: true })

const dirty = computed(() => loaded.value && snapshot() !== baseline.value)
const canEdit = computed(() => query.data.value?.can_edit === true)
const lifecycleLocked = computed(() => query.data.value?.state === 'done' || query.data.value?.state === 'cancelled')
const canSave = computed(() => canEdit.value && !lifecycleLocked.value && dirty.value)

async function save() {
  if (!hydrated.value || isPending.value || !canSave.value) return
  await mutateAsync({
    id: id.value,
    body: { agenda: agenda.value, minutes: minutes.value, scope: 'this' },
  })
  baseline.value = snapshot()
  await nextTick()
  await navigateTo(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('meetingsUx.minutesEditorTitle')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.isLoading.value && !query.error.value && !query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="nasq-form nasq-panel nasq-panel-body grid gap-4" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <p class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          {{ t('meetingsUx.minutesEditorContext', { name: query.data.value.name }) }}
        </p>
        <p v-if="lifecycleLocked && query.data.value.can_manage" role="alert" class="text-sm text-muted-foreground">{{ t('meetingsUx.minutesEditorReopen') }} <NuxtLink :to="returnTo" class="text-brand-link underline">{{ t('meetingsUx.openMeetingForReopen') }}</NuxtLink></p>
        <p v-else-if="!canEdit" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.minutesEditorForbidden') }}</p>
        <SharedFormSection :title="t('meetingsUi.agenda')">
          <ClientOnly>
            <DescriptionEditor :model-value="agenda" :task-id="id" :aria-label="t('meetingsUx.agendaLabel')" :readonly="!canEdit || lifecycleLocked || isPending" @draft="agenda = $event.html" />
          </ClientOnly>
        </SharedFormSection>
        <SharedFormSection :title="t('meetingsUi.minutes')">
          <ClientOnly>
            <DescriptionEditor :model-value="minutes" :task-id="-id" :aria-label="t('meetingsUx.minutesLabel')" :readonly="!canEdit || lifecycleLocked || isPending" @draft="minutes = $event.html" />
          </ClientOnly>
        </SharedFormSection>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('meetingsUx.errors.save') }}</p>
        <div class="flex justify-end gap-2">
          <NuxtLink :to="returnTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink>
          <Button type="submit" :disabled="!hydrated || isPending || !canSave">{{ t('app.save') }}</Button>
        </div>
      </form>
    </SharedPageState>
  </SharedPageContainer>
</template>
