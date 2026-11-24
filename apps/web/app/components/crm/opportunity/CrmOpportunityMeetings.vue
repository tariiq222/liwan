<script setup lang="ts">
import type { CrmOpportunityMeetingCreate, MeetingListItem } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'

// The meetings of one opportunity (the CRM bridge to the meetings application): name, date and state of each, linked
// to the meeting's own page, and an inline form that adds one. The form sends the day, the place, the link and the
// agenda; attendees, the secretary and the hours are set on the meeting's page, which opens after the save.
const props = defineProps<{
  meetings: MeetingListItem[]
  total: number
  loading?: boolean
  error?: unknown
  canWrite: boolean
  pending?: boolean
  formError?: string
}>()
const emit = defineEmits<{ create: [body: CrmOpportunityMeetingCreate]; retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const STATE_TONE = { draft: 'neutral', confirmed: 'info', done: 'success', cancelled: 'destructive' } as const
const adding = ref(false)
const attempted = ref(false)
const name = ref('')
const day = ref<string | null>(null)
const location = ref('')
const url = ref('')
const agenda = ref('')
const locked = computed(() => !hydrated.value || props.pending)

function reset() {
  adding.value = false
  attempted.value = false
  name.value = ''
  day.value = null
  location.value = ''
  url.value = ''
  agenda.value = ''
}

function submit() {
  attempted.value = true
  const trimmed = name.value.trim()
  if (!trimmed) return
  const body: CrmOpportunityMeetingCreate = { name: trimmed }
  if (day.value) body.meeting_date = day.value
  if (location.value.trim()) body.location = location.value.trim()
  if (url.value.trim()) body.meeting_url = url.value.trim()
  if (agenda.value.trim()) body.agenda = agenda.value.trim()
  emit('create', body)
}

defineExpose({ reset })
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.meetings.title')" data-testid="crm-meetings">
    <template v-if="canWrite && !adding" #actions>
      <UButton size="xs" variant="outline" icon="i-lucide-plus" :label="t('crm.opportunities.meetings.add')" :disabled="!hydrated" data-testid="crm-meeting-add" @click="adding = true" />
    </template>
    <div class="grid gap-4">
      <UForm v-if="adding" novalidate :state="{}" class="liwan-form" data-testid="crm-meeting-form" @submit="submit">
        <UFormField :label="t('crm.opportunities.meetings.name')" name="meeting-name" required :error="attempted && !name.trim() ? t('crm.opportunities.meetings.nameRequired') : undefined">
          <UInput id="crm-meeting-name" v-model="name" class="w-full" :disabled="locked" />
        </UFormField>
        <div class="liwan-auto-grid gap-(--liwan-gap-card)">
          <UFormField :label="t('crm.opportunities.meetings.date')" name="meeting-date">
            <SharedDateField id="crm-meeting-date" v-model="day" :aria-label="t('crm.opportunities.meetings.date')" :disabled="locked" />
          </UFormField>
          <UFormField :label="t('crm.opportunities.meetings.location')" name="meeting-location">
            <UInput id="crm-meeting-location" v-model="location" class="w-full" :disabled="locked" />
          </UFormField>
        </div>
        <UFormField :label="t('crm.opportunities.meetings.url')" name="meeting-url">
          <UInput id="crm-meeting-url" v-model="url" class="w-full" dir="ltr" type="url" :disabled="locked" />
        </UFormField>
        <UFormField :label="t('crm.opportunities.meetings.agenda')" name="meeting-agenda">
          <UTextarea id="crm-meeting-agenda" v-model="agenda" class="w-full" :rows="3" :disabled="locked" />
        </UFormField>
        <UAlert v-if="formError" role="alert" color="error" variant="subtle" :description="formError" data-testid="crm-meeting-error" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="locked" @click="reset" />
          <UButton type="submit" :loading="props.pending" :disabled="locked" :label="t('crm.opportunities.meetings.submit')" data-testid="crm-meeting-submit" />
        </div>
      </UForm>
      <SharedPageState empty-icon="i-lucide-calendar-days" :loading="loading" :error="error" :empty="!meetings.length" :empty-text="t('crm.opportunities.meetings.empty')" @retry="emit('retry')">
        <ul class="divide-y divide-default" data-testid="crm-meeting-list">
          <li v-for="meeting in meetings" :key="meeting.id" class="grid gap-1 py-3 first:pt-0 last:pb-0">
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <NuxtLink :to="`/meetings/${meeting.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">{{ meeting.name }}</NuxtLink>
              <SharedStatusBadge :tone="STATE_TONE[meeting.state]" :label="t(`crm.opportunities.meetings.state.${meeting.state}`)" size="sm" />
            </div>
            <p class="flex flex-wrap gap-x-3 text-sm text-muted">
              <span>{{ meeting.meeting_date ? formatCalendarDate(meeting.meeting_date) : t('crm.opportunities.meetings.noDate') }}</span>
              <span v-if="meeting.organizer">{{ meeting.organizer.name }}</span>
            </p>
          </li>
        </ul>
        <p v-if="total > meetings.length" class="mt-3 border-t border-default pt-3 text-sm text-muted">{{ t('crm.opportunities.meetings.count', { shown: meetings.length, total }) }}</p>
      </SharedPageState>
    </div>
  </SharedRecordSection>
</template>
