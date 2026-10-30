<script setup lang="ts">
import type { InboxWorkingHours } from '@liwan/contracts'
import InboxWorkingHoursEditor from '@/components/inbox/InboxWorkingHoursEditor.vue'
import { draftToHours, hoursToDraft, hoursValid } from '@/composables/inbox/inboxAutomation'
import { useSaveInboxWorkingHours } from '@/composables/inbox/useInboxAutomation'

// The company's working hours form. It starts from the hours it is given (so the server and the client render the same
// first frame) and starts again from the saved hours after a save.
const props = defineProps<{ hours: InboxWorkingHours }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: save, isPending } = useSaveInboxWorkingHours()
const draft = ref(hoursToDraft(props.hours))
const initial = ref(JSON.stringify(draft.value))
watch(() => props.hours, (hours) => {
  draft.value = hoursToDraft(hours)
  initial.value = JSON.stringify(draft.value)
})
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value)
const valid = computed(() => hoursValid(draft.value))

function submit() {
  if (!hydrated.value || !dirty.value || !valid.value || isPending.value) return
  save(draftToHours(draft.value), {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <form class="flex flex-col gap-5" novalidate data-testid="inbox-hours-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedRecordSection variant="panel" :description="t('inbox.automation.hours.hint')">
      <InboxWorkingHoursEditor v-model="draft" :disabled="isPending" />
    </SharedRecordSection>
    <div class="flex justify-end">
      <UButton type="submit" :disabled="!hydrated || !dirty || !valid" :loading="isPending" :label="t('app.save')" data-testid="inbox-hours-save" />
    </div>
  </form>
</template>
