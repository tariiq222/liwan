<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import type { Milestone } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate, fromCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useCreateMilestone, useUpdateMilestone } from '@/composables/useMilestones'

// Create-or-edit, decided by whether `milestone` is set — same instance is
// reused for both flows by the table (v-model'd, re-seeded on every open),
// same reasoning as CreateTaskDialog/CreateProjectDialog.
const props = defineProps<{ open: boolean; projectId: number; milestone?: Milestone }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createMutate, isPending: creating } = useCreateMilestone()
const { mutateAsync: updateMutate, isPending: updating } = useUpdateMilestone()

const isEdit = computed(() => !!props.milestone)
const isPending = computed(() => creating.value || updating.value)

const name = ref('')
// shallowRef, not ref: CalendarDate uses private class fields, and Vue's
// deep-reactivity unwrap (UnwrapRef, which a plain ref<T>() applies) turns a
// class instance with private fields into a structurally-mapped type that
// TypeScript then rejects everywhere the real CalendarDate is expected
// (fromCalendarDate, the Calendar component's model-value). shallowRef skips
// that unwrap and keeps the branded class type intact — this value is also
// never mutated in place, only replaced wholesale, so shallow is correct.
const deadline = shallowRef<CalendarDate | undefined>(undefined)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = props.milestone?.name ?? ''
    deadline.value = toCalendarDate(props.milestone?.deadline ?? null)
    error.value = null
  },
)

const deadlineLabel = computed(() =>
  deadline.value ? formatCalendarDate(fromCalendarDate(deadline.value), locale.value) : t('projects.milestones.deadline'),
)

function onCalendarChange(v: unknown) {
  deadline.value = v as CalendarDate
}
function clearDeadline() {
  deadline.value = undefined
}

async function submit() {
  error.value = null
  const trimmed = name.value.trim()
  if (!trimmed) return
  try {
    if (props.milestone) {
      await updateMutate({
        projectId: props.projectId,
        id: props.milestone.id,
        patch: { name: trimmed, deadline: fromCalendarDate(deadline.value) },
      })
    } else {
      await createMutate({ projectId: props.projectId, name: trimmed, deadline: fromCalendarDate(deadline.value) })
    }
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ isEdit ? t('projects.milestones.edit') : t('projects.milestones.new') }}</DialogTitle>
      </DialogHeader>
      <form class="grid gap-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="milestone-name">{{ t('projects.milestones.name') }}</Label>
          <Input id="milestone-name" v-model="name" required :disabled="!hydrated || isPending" />
        </div>
        <div class="grid gap-2">
          <Label>{{ t('projects.milestones.deadline') }}</Label>
          <Popover>
            <PopoverTrigger as-child>
              <Button
                variant="outline" type="button" class="w-full justify-start" :disabled="!hydrated || isPending"
                :aria-label="t('projects.milestones.deadline')"
              >
                {{ deadlineLabel }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar :model-value="deadline" @update:model-value="onCalendarChange" />
              <div v-if="deadline" class="border-t p-2">
                <Button variant="ghost" size="sm" type="button" class="w-full" @click="clearDeadline">
                  {{ t('tasks.deadline.none') }}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
