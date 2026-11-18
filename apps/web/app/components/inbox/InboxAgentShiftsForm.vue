<script setup lang="ts">
import InboxWorkingHoursEditor from '@/components/inbox/InboxWorkingHoursEditor.vue'
import { draftToHours, emptyHoursDraft, hoursToDraft, hoursValid } from '@/composables/inbox/inboxAutomation'
import { useInboxAgentShifts, useSaveInboxAgentShifts } from '@/composables/inbox/useInboxAgentShifts'

// One agent's weekly shift, edited with the working-hours grid without its timezone and holidays: the shift follows the
// company inbox timezone. No range at all means the agent is always in shift. Saving is explicit.
const props = defineProps<{ userId: number }>()
const emit = defineEmits<{ close: []; dirty: [value: boolean] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxAgentShifts(() => props.userId)
const { mutate: save, isPending } = useSaveInboxAgentShifts(() => props.userId)
const draft = ref(emptyHoursDraft())
const initial = ref(JSON.stringify(draft.value))
watch(data, (shifts) => {
  if (!shifts) return
  draft.value = hoursToDraft({ timezone: draft.value.timezone, days: shifts.ranges, holidays: [] })
  initial.value = JSON.stringify(draft.value)
}, { immediate: true })
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value)
const valid = computed(() => hoursValid(draft.value))
// The host guards leaving a form with an unsaved draft, so it needs to know when there is one.
watch(dirty, value => emit('dirty', value), { immediate: true })
onBeforeUnmount(() => emit('dirty', false))

function submit() {
  if (!hydrated.value || !dirty.value || !valid.value || isPending.value) return
  save({ ranges: draftToHours(draft.value).days }, {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <form class="flex flex-col gap-3 rounded-control bg-elevated/50 p-3" novalidate data-testid="inbox-agent-shifts-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <template v-else>
      <InboxWorkingHoursEditor v-model="draft" ranges-only :disabled="isPending" />
      <div class="flex justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="isPending" :label="t('app.cancel')" @click="emit('close')" />
        <UButton type="submit" :disabled="!hydrated || !dirty || !valid" :loading="isPending" :label="t('app.save')" data-testid="inbox-agent-shifts-save" />
      </div>
    </template>
  </form>
</template>
