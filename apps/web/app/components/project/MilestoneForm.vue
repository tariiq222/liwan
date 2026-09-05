<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { Milestone } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useCreateMilestone, useUpdateMilestone } from '@/composables/useMilestones'

const props = defineProps<{ projectId: number; milestone?: Milestone }>()
const emit = defineEmits<{ saved: [id?: number]; cancel: [] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createMutate, isPending: creating } = useCreateMilestone()
const { mutateAsync: updateMutate, isPending: updating } = useUpdateMilestone()
const isEdit = computed(() => !!props.milestone)
const isPending = computed(() => creating.value || updating.value)
const name = ref(props.milestone?.name ?? '')
const deadline = shallowRef<CalendarDate | undefined>(toCalendarDate(props.milestone?.deadline ?? null))
const error = ref<string | null>(null)

watch(() => props.milestone, (milestone) => {
  name.value = milestone?.name ?? ''
  deadline.value = toCalendarDate(milestone?.deadline ?? null)
}, { immediate: true })

const deadlineLabel = computed(() => deadline.value ? formatCalendarDate(fromCalendarDate(deadline.value), locale.value) : t('projects.milestones.deadline'))
function onCalendarChange(v: unknown) { deadline.value = v as CalendarDate }
function clearDeadline() { deadline.value = undefined }

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!trimmed) return
  try {
    if (props.milestone) {
      await updateMutate({ projectId: props.projectId, id: props.milestone.id, patch: { name: trimmed, deadline: fromCalendarDate(deadline.value) } })
      emit('saved', props.milestone.id)
    } else {
      const created = await createMutate({ projectId: props.projectId, name: trimmed, deadline: fromCalendarDate(deadline.value) })
      emit('saved', created.id)
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form data-testid="milestone-form" class="grid gap-4" @submit.prevent="submit">
    <div class="grid gap-2">
      <Label for="milestone-name">{{ t('projects.milestones.name') }}</Label>
      <Input id="milestone-name" v-model="name" required :disabled="!hydrated || isPending" />
    </div>
    <div class="grid gap-2">
      <Label>{{ t('projects.milestones.deadline') }}</Label>
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="outline" type="button" class="w-full justify-start" :disabled="!hydrated || isPending" :aria-label="t('projects.milestones.deadline')">{{ deadlineLabel }}</Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
          <Calendar :model-value="deadline" @update:model-value="onCalendarChange" />
          <div v-if="deadline" class="border-t p-2">
            <Button variant="ghost" size="sm" type="button" class="w-full" @click="clearDeadline">{{ t('tasks.deadline.none') }}</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">{{ t('app.cancel') }}</Button>
      <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ isEdit ? t('app.save') : t('app.create') }}</Button>
    </div>
  </form>
</template>
