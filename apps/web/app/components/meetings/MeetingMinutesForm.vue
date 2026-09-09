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
} from './meetingMinutesForm'

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
  'save-and-create-resolution': []
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
    <section class="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <h3 class="font-semibold">{{ t('meetingMinutesForm.metadata') }}</h3>
      <dl class="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.name') }}</dt><dd class="break-words">{{ meeting.name || '—' }}</dd></div>
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.reference') }}</dt><dd dir="ltr">{{ meeting.reference || '—' }}</dd></div>
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.date') }}</dt><dd>{{ formatMeetingDate(meeting.meeting_date, locale) }}</dd></div>
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.time') }}</dt><dd dir="ltr"><bdi>{{ formatMeetingTime(meeting.start_datetime, locale) }}</bdi><span v-if="meeting.end_datetime"> – <bdi>{{ formatMeetingTime(meeting.end_datetime, locale) }}</bdi></span></dd></div>
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.location') }}</dt><dd>{{ meeting.location || '—' }}</dd></div>
        <div><dt class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.secretary') }}</dt><dd>{{ meeting.secretary?.name || '—' }}</dd></div>
      </dl>
      <div class="flex flex-wrap gap-2 text-sm">
        <span class="text-muted-foreground">{{ t('meetingMinutesForm.attendees') }}:</span>
        <span v-if="meeting.attendees?.length">{{ meeting.attendees.map(person => person.name).join('، ') }}</span>
        <span v-else>—</span>
      </div>
    </section>

    <section class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ t('meetingMinutesForm.signoff') }}</h3>
        <span class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.missingOnly') }}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-1">
          <Label for="minutes-chairperson">{{ t('meetingMinutesForm.chairperson') }}</Label>
          <Input id="minutes-chairperson" :model-value="modelValue.chairperson" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ chairperson: String($event) })" />
        </div>
        <div class="grid gap-1">
          <Label for="minutes-approver-name">{{ t('meetingMinutesForm.approverName') }}</Label>
          <Input id="minutes-approver-name" :model-value="modelValue.approver_name" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ approver_name: String($event) })" />
        </div>
        <div class="grid gap-1 sm:col-span-2">
          <Label for="minutes-approver-title">{{ t('meetingMinutesForm.approverTitle') }}</Label>
          <Input id="minutes-approver-title" :model-value="modelValue.approver_title" maxlength="500" :disabled="readonly || pending || !hydrated" @update:model-value="update({ approver_title: String($event) })" />
        </div>
      </div>
    </section>

    <section class="grid gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ t('meetingMinutesForm.body') }}</h3>
        <Button v-if="legacyAgenda && !modelValue.opening.trim()" type="button" variant="outline" size="sm" :disabled="readonly || pending || !hydrated" @click="readAgenda">{{ t('meetingMinutesForm.readAgenda') }}</Button>
      </div>
      <div class="grid gap-1">
        <Label for="minutes-opening">{{ t('meetingMinutesForm.opening') }}</Label>
        <textarea id="minutes-opening" :value="modelValue.opening" maxlength="50000" class="border-input min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm" :disabled="readonly || pending" @input="update({ opening: normalizeMeetingMinutesText(($event.target as HTMLTextAreaElement).value) })" />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold">{{ t('meetingMinutesForm.topics') }}</h4>
        <Button type="button" variant="outline" size="sm" :disabled="readonly || pending || modelValue.topics.length >= 100 || !hydrated" @click="addTopic">{{ t('meetingMinutesForm.addTopic') }}</Button>
      </div>
      <div v-if="!modelValue.topics.length" class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{{ t('meetingMinutesForm.noTopics') }}</div>
      <article v-for="(topic, index) in modelValue.topics" :key="topic.key" class="grid gap-3 rounded-lg border border-border p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h5 class="font-medium">{{ t('meetingMinutesForm.topicNumber', { number: index + 1 }) }}</h5>
          <div class="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" :aria-label="t('meetingMinutesForm.moveUp')" :disabled="readonly || pending || !hydrated || index === 0" @click="moveTopic(index, -1)">↑</Button>
            <Button type="button" variant="ghost" size="sm" :aria-label="t('meetingMinutesForm.moveDown')" :disabled="readonly || pending || !hydrated || index === modelValue.topics.length - 1" @click="moveTopic(index, 1)">↓</Button>
            <Button type="button" variant="ghost" size="sm" class="text-destructive" :disabled="readonly || pending || !hydrated" @click="removeTopic(index)">{{ t('meetingMinutesForm.removeTopic') }}</Button>
          </div>
        </div>
        <div class="grid gap-1">
          <Label :for="`minutes-topic-title-${topic.key}`">{{ t('meetingMinutesForm.topicTitle') }}</Label>
          <Input :id="`minutes-topic-title-${topic.key}`" :model-value="topic.title" maxlength="500" :disabled="readonly || pending" @update:model-value="updateTopic(index, { title: String($event) })" />
        </div>
        <div class="grid gap-1">
          <Label :for="`minutes-topic-discussion-${topic.key}`">{{ t('meetingMinutesForm.discussion') }}</Label>
          <textarea :id="`minutes-topic-discussion-${topic.key}`" :value="topic.discussion" maxlength="50000" class="border-input min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm" :disabled="readonly || pending" @input="updateTopic(index, { discussion: normalizeMeetingMinutesText(($event.target as HTMLTextAreaElement).value) })" />
        </div>
        <div class="grid gap-1">
          <Label :for="`minutes-topic-project-${topic.key}`">{{ t('meetingMinutesForm.project') }}</Label>
          <MeetingProjectFilter :id="`minutes-topic-project-${topic.key}`" hide-label :model-value="topic.project_id ?? undefined" :disabled="readonly || pending" @update:model-value="updateTopic(index, { project_id: $event ?? null })" />
        </div>
        <div class="grid gap-1">
          <Label :for="`minutes-topic-resolutions-${topic.key}`">{{ t('meetingMinutesForm.recommendations') }}</Label>
          <fieldset :id="`minutes-topic-resolutions-${topic.key}`" class="grid gap-2 rounded-lg border border-border p-3">
            <legend class="sr-only">{{ t('meetingMinutesForm.recommendations') }}</legend>
            <label v-for="item in availableRecommendations(index)" :key="item.id" class="flex min-w-0 items-start gap-2 text-sm">
              <input type="checkbox" :checked="topic.resolution_ids.includes(item.id)" :disabled="readonly || pending || !hydrated" @change="toggleRecommendation(index, item.id, ($event.target as HTMLInputElement).checked)">
              <span class="min-w-0 break-words">{{ item.name }}</span>
            </label>
            <p v-if="!availableRecommendations(index).length" class="text-sm text-muted-foreground">{{ t('meetingMinutesForm.noRecommendations') }}</p>
          </fieldset>
          <p class="text-xs text-muted-foreground">{{ t('meetingMinutesForm.recommendationsHint') }}</p>
        </div>
        <div v-if="topic.resolution_ids.length" class="grid gap-2 rounded-lg bg-muted/30 p-3">
          <div v-for="resolutionId in topic.resolution_ids" :key="resolutionId" class="grid gap-1 text-sm">
            <span class="font-medium">{{ recommendationFor(resolutionId)?.name || t('meetingMinutesForm.hiddenRecommendation') }}</span>
            <span v-if="recommendationFor(resolutionId)" class="text-muted-foreground">{{ formatRecommendationMeta(recommendationFor(resolutionId)!) || '—' }}</span>
            <span v-if="recommendationFor(resolutionId)?.result" class="whitespace-pre-wrap text-muted-foreground">{{ recommendationFor(resolutionId)?.result }}</span>
          </div>
        </div>
      </article>
    </section>

    <section class="grid gap-1">
      <Label for="minutes-closing">{{ t('meetingMinutesForm.closing') }}</Label>
      <textarea id="minutes-closing" :value="modelValue.closing" maxlength="50000" class="border-input min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm" :disabled="readonly || pending" @input="update({ closing: normalizeMeetingMinutesText(($event.target as HTMLTextAreaElement).value) })" />
    </section>

    <div v-if="!readonly" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
      <span class="text-sm text-muted-foreground">{{ t('meetingMinutesForm.addRecommendationHint') }}</span>
      <Button type="button" variant="outline" :disabled="pending || !hydrated" @click="emit('save-and-create-resolution')">{{ t('meetingMinutesForm.saveAndCreateRecommendation') }}</Button>
    </div>
  </div>
</template>
