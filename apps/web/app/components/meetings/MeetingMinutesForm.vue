<script setup lang="ts">
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import {
  formatMeetingDate,
  formatMeetingTime,
  normalizeMeetingMinutesText,
  newMeetingMinutesTopic,
  plainTextFromHtml,
  type MeetingMinutesFormValue,
  type MeetingMinutesRecommendation,
} from '@/utils/meetingMinutesForm'

type MeetingMetadata = {
  name: string
  reference?: string | null
  meeting_date?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  location?: string | null
  organizer?: { name: string } | null
  secretary?: { name: string } | null
  attendees?: Array<{ id: number; name: string }>
}

const props = withDefaults(defineProps<{
  modelValue: MeetingMinutesFormValue
  meeting: MeetingMetadata
  recommendations?: MeetingMinutesRecommendation[]
  legacyAgenda?: string | null
  readonly?: boolean
  pending?: boolean
}>(), { recommendations: () => [], legacyAgenda: '', readonly: false, pending: false })
const emit = defineEmits<{
  'update:modelValue': [value: MeetingMinutesFormValue]
  'save-and-create-resolution': [topicKey?: string]
}>()

const { t, locale } = useI18n()
const hydrated = useHydrated()

function update(patch: Partial<MeetingMinutesFormValue>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
function updateTopic(index: number, patch: Partial<MeetingMinutesFormValue['topics'][number]>) {
  const topics = props.modelValue.topics.map((topic, topicIndex) => topicIndex === index ? { ...topic, ...patch } : topic)
  update({ topics })
}
function addTopic() {
  if (props.readonly || props.modelValue.topics.length >= 100) return
  update({ topics: [...props.modelValue.topics, newMeetingMinutesTopic()] })
}
function removeTopic(index: number) {
  if (props.readonly) return
  update({ topics: props.modelValue.topics.filter((_, topicIndex) => topicIndex !== index) })
}
function moveTopic(index: number, direction: -1 | 1) {
  const target = index + direction
  if (props.readonly || target < 0 || target >= props.modelValue.topics.length) return
  const topics = [...props.modelValue.topics]
  const [topic] = topics.splice(index, 1)
  if (!topic) return
  topics.splice(target, 0, topic)
  update({ topics })
}
function toggleRecommendation(index: number, resolutionId: number, selected: boolean) {
  const current = props.modelValue.topics[index]?.resolution_ids ?? []
  const resolutionIds = selected
    ? [...new Set([...current, resolutionId])]
    : current.filter(id => id !== resolutionId)
  updateTopic(index, { resolution_ids: resolutionIds })
}
function availableRecommendations(index: number) {
  const assignedElsewhere = new Set(props.modelValue.topics.flatMap((topic, topicIndex) => topicIndex === index ? [] : topic.resolution_ids))
  return props.recommendations.filter(item => !assignedElsewhere.has(item.id))
}
function recommendationFor(id: number) {
  return props.recommendations.find(item => item.id === id)
}
function formatRecommendationMeta(item: MeetingMinutesRecommendation) {
  return [item.responsible?.name, item.execution_period, item.deadline ? formatMeetingDate(item.deadline, locale.value) : ''].filter(Boolean).join(' · ')
}
function readAgenda() {
  if (props.readonly || props.modelValue.opening.trim() || !props.legacyAgenda) return
  update({ opening: normalizeMeetingMinutesText(plainTextFromHtml(props.legacyAgenda)) })
}
</script>

<template>
  <div class="grid gap-5" data-testid="meeting-minutes-form">
    <section class="grid gap-3 rounded-lg bg-elevated/50 p-4 ring ring-default">
      <h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.metadata') }}</h3>
      <dl class="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.name') }}</dt><dd class="break-words">{{ meeting.name || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.reference') }}</dt><dd dir="ltr">{{ meeting.reference || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.date') }}</dt><dd>{{ formatMeetingDate(meeting.meeting_date, locale) }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.time') }}</dt><dd dir="ltr"><bdi>{{ formatMeetingTime(meeting.start_datetime, locale) }}</bdi><span v-if="meeting.end_datetime"> – <bdi>{{ formatMeetingTime(meeting.end_datetime, locale) }}</bdi></span></dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.location') }}</dt><dd>{{ meeting.location || '—' }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t('meetingMinutesForm.secretary') }}</dt><dd>{{ meeting.secretary?.name || '—' }}</dd></div>
      </dl>
      <div class="flex flex-wrap gap-2 text-sm">
        <span class="text-muted">{{ t('meetingMinutesForm.attendees') }}:</span>
        <span v-if="meeting.attendees?.length">{{ meeting.attendees.map(person => person.name).join('، ') }}</span>
        <span v-else>—</span>
      </div>
    </section>



    <section class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.body') }}</h3>
        <UButton v-if="legacyAgenda && !modelValue.opening.trim()" type="button" color="neutral" variant="outline" size="sm" :disabled="readonly || pending || !hydrated" :label="t('meetingMinutesForm.readAgenda')" @click="readAgenda" />
      </div>
      <UFormField :label="t('meetingMinutesForm.opening')" class="grid gap-1">
        <UTextarea id="minutes-opening" :model-value="modelValue.opening" class="w-full" maxlength="50000" :rows="4" :disabled="readonly || pending || !hydrated" @update:model-value="update({ opening: normalizeMeetingMinutesText(String($event)) })" />
      </UFormField>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.topics') }}</h4>
        <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="readonly || pending || modelValue.topics.length >= 100 || !hydrated" :label="t('meetingMinutesForm.addTopic')" @click="addTopic" />
      </div>
      <SharedEmptyState v-if="!modelValue.topics.length" :title="t('meetingMinutesForm.noTopics')" />
      <article v-for="(topic, index) in modelValue.topics" :id="`meeting-minutes-topic-${topic.key}`" tabindex="-1" :key="topic.key" class="grid gap-3 rounded-lg bg-default p-4 ring ring-default">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h5 class="font-medium text-highlighted">{{ t('meetingMinutesForm.topicNumber', { number: index + 1 }) }}</h5>
          <div class="flex flex-wrap items-center gap-1">
            <UButton type="button" color="neutral" variant="ghost" size="sm" :aria-label="t('meetingMinutesForm.moveUp')" square icon="i-lucide-arrow-up" :disabled="readonly || pending || !hydrated || index === 0" @click="moveTopic(index, -1)" />
            <UButton type="button" color="neutral" variant="ghost" size="sm" :aria-label="t('meetingMinutesForm.moveDown')" square icon="i-lucide-arrow-down" :disabled="readonly || pending || !hydrated || index === modelValue.topics.length - 1" @click="moveTopic(index, 1)" />
            <UButton type="button" color="error" variant="ghost" size="sm" :disabled="readonly || pending || !hydrated" :label="t('meetingMinutesForm.removeTopic')" @click="removeTopic(index)" />
          </div>
        </div>
        <UFormField :label="t('meetingMinutesForm.topicTitle')" class="grid gap-1">
          <UInput :id="`minutes-topic-title-${topic.key}`" :model-value="topic.title" class="w-full" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="updateTopic(index, { title: String($event) })" />
        </UFormField>
        <UFormField :label="t('meetingMinutesForm.discussion')" class="grid gap-1">
          <UTextarea :id="`minutes-topic-discussion-${topic.key}`" :model-value="topic.discussion" class="w-full" maxlength="50000" :rows="4" :disabled="readonly || pending || !hydrated" @update:model-value="updateTopic(index, { discussion: normalizeMeetingMinutesText(String($event)) })" />
        </UFormField>
        <UFormField :label="t('meetingMinutesForm.project')" class="grid gap-1">
          <MeetingProjectFilter :id="`minutes-topic-project-${topic.key}`" hide-label :model-value="topic.project_id ?? undefined" :disabled="readonly || pending || !hydrated" @update:model-value="updateTopic(index, { project_id: $event ?? null })" />
        </UFormField>
        <UButton v-if="!readonly" type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="pending || !hydrated" :label="t('meetingMinutesForm.saveAndCreateRecommendation')" @click="emit('save-and-create-resolution', topic.key)" />
        <div class="grid gap-1">
          <span :id="`minutes-topic-resolutions-${topic.key}`" class="text-sm font-medium text-highlighted">{{ t('meetingMinutesForm.recommendations') }}</span>
          <fieldset :aria-labelledby="`minutes-topic-resolutions-${topic.key}`" class="grid gap-2 rounded-lg p-3 ring ring-default">
            <legend class="sr-only">{{ t('meetingMinutesForm.recommendations') }}</legend>
            <label v-for="item in availableRecommendations(index)" :key="item.id" class="flex min-w-0 items-start gap-2 text-sm">
              <UCheckbox :model-value="topic.resolution_ids.includes(item.id)" :disabled="readonly || pending || !hydrated" :aria-label="item.name" @update:model-value="toggleRecommendation(index, item.id, Boolean($event))" />
              <span class="min-w-0 break-words">{{ item.name }}</span>
            </label>
            <p v-if="!availableRecommendations(index).length" class="text-sm text-muted">{{ t('meetingMinutesForm.noRecommendations') }}</p>
          </fieldset>
          <p class="text-xs text-muted">{{ t('meetingMinutesForm.recommendationsHint') }}</p>
        </div>
        <div v-if="topic.resolution_ids.length" class="grid gap-2 rounded-md bg-elevated p-3">
          <div v-for="resolutionId in topic.resolution_ids" :key="resolutionId" class="grid gap-1 text-sm">
            <span class="font-medium text-highlighted">{{ recommendationFor(resolutionId)?.name || t('meetingMinutesForm.hiddenRecommendation') }}</span>
            <span v-if="recommendationFor(resolutionId)" class="text-muted">{{ formatRecommendationMeta(recommendationFor(resolutionId)!) || '—' }}</span>
            <span v-if="recommendationFor(resolutionId)?.result" class="whitespace-pre-wrap text-muted">{{ recommendationFor(resolutionId)?.result }}</span>
          </div>
        </div>
      </article>
    </section>

    <UFormField :label="t('meetingMinutesForm.closing')" class="grid gap-1">
      <UTextarea id="minutes-closing" :model-value="modelValue.closing" class="w-full" maxlength="50000" :rows="4" :disabled="readonly || pending || !hydrated" @update:model-value="update({ closing: normalizeMeetingMinutesText(String($event)) })" />
    </UFormField>

    <section class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold text-highlighted">{{ t('meetingMinutesForm.signoff') }}</h3>
        <span class="text-xs text-muted">{{ t('meetingMinutesForm.missingOnly') }}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('meetingMinutesForm.chairperson')" class="grid gap-1">
          <UInput id="minutes-chairperson" :model-value="modelValue.chairperson" class="w-full" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ chairperson: String($event) })" />
        </UFormField>
        <UFormField :label="t('meetingMinutesForm.approverName')" class="grid gap-1">
          <UInput id="minutes-approver-name" :model-value="modelValue.approver_name" class="w-full" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ approver_name: String($event) })" />
        </UFormField>
        <UFormField :label="t('meetingMinutesForm.approverTitle')" class="grid gap-1">
          <UInput id="minutes-approver-title" :model-value="modelValue.approver_title" class="w-full" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ approver_title: String($event) })" />
        </UFormField>
      </div>
    </section>

    <div v-if="!readonly" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-default p-3">
      <span class="text-sm text-muted">{{ t('meetingMinutesForm.addRecommendationHint') }}</span>
      <UButton type="button" color="neutral" variant="outline" :disabled="pending || !hydrated" :label="t('meetingMinutesForm.saveAndCreateRecommendation')" @click="emit('save-and-create-resolution')" />
    </div>
  </div>
</template>
