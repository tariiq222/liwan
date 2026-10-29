<script setup lang="ts">
import InboxWorkingHoursEditor from '@/components/inbox/InboxWorkingHoursEditor.vue'
import { draftToHours, emptyHoursDraft, hoursToDraft, hoursValid } from '@/composables/inbox/inboxAutomation'
import { useInboxDepartmentWorkingHours, useInboxWorkingHours, useSaveInboxDepartmentWorkingHours } from '@/composables/inbox/useInboxAutomation'

// A department's own working hours, inside its edit form. Off means the department follows the company's hours; on
// starts from the company's hours so only the differences are edited. It saves on its own button (a separate request).
const props = defineProps<{ departmentId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxDepartmentWorkingHours(() => props.departmentId)
const company = useInboxWorkingHours()
const { mutate: save, isPending } = useSaveInboxDepartmentWorkingHours(() => props.departmentId)

const own = ref(false)
const draft = ref(emptyHoursDraft())
const initial = ref('')
const snapshot = () => JSON.stringify({ own: own.value, draft: own.value ? draft.value : null })
watch(query.data, (value) => {
  if (!value) return
  own.value = value.working_hours !== null
  draft.value = value.working_hours ? hoursToDraft(value.working_hours) : emptyHoursDraft()
  initial.value = snapshot()
}, { immediate: true })
const dirty = computed(() => !!query.data.value && snapshot() !== initial.value)
const valid = computed(() => !own.value || hoursValid(draft.value))

function setOwn(value: boolean) {
  own.value = value
  if (value && company.data.value && !draft.value.week.some(day => day.length)) draft.value = hoursToDraft(company.data.value)
}
function submit() {
  if (!hydrated.value || !dirty.value || !valid.value || isPending.value) return
  save(own.value ? draftToHours(draft.value) : null, {
    onSuccess: () => {
      initial.value = snapshot()
      toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <section class="flex flex-col gap-3 border-t border-default pt-3" data-testid="inbox-department-hours">
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <template v-else>
      <div class="flex items-start gap-3">
        <USwitch :model-value="own" :aria-label="t('inbox.automation.hours.ownHours')" :disabled="!hydrated || isPending" data-testid="inbox-department-hours-own" @update:model-value="setOwn" />
        <div>
          <p class="text-sm font-medium text-highlighted">{{ t('inbox.automation.hours.ownHours') }}</p>
          <p class="text-xs text-muted">{{ own ? t('inbox.automation.hours.ownHoursOn') : t('inbox.automation.hours.ownHoursOff') }}</p>
        </div>
      </div>
      <InboxWorkingHoursEditor v-if="own" v-model="draft" :disabled="isPending" />
      <div class="flex justify-end">
        <UButton type="button" variant="outline" color="neutral" :disabled="!hydrated || !dirty || !valid" :loading="isPending" :label="t('inbox.automation.hours.saveDepartment')" data-testid="inbox-department-hours-save" @click="submit" />
      </div>
    </template>
  </section>
</template>
