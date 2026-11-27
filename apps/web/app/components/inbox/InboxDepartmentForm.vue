<script setup lang="ts">
import { InboxDepartmentWriteSchema, type InboxDepartment } from '@liwan/contracts'
import { useSaveInboxDepartment } from '@/composables/inbox/useInboxSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Form for creating a department or editing its name and members.
const props = defineProps<{ department?: InboxDepartment }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending: saving } = useSaveInboxDepartment()

const name = ref(props.department?.name ?? '')
const memberIds = ref<number[]>(props.department?.members.map(member => member.id) ?? [])
const known = computed(() => props.department?.members ?? [])
const initialName = ref(name.value)
const initialMemberIds = ref([...memberIds.value])
const attempted = ref(false)
const submitted = ref(false)
const failure = ref<unknown>(null)

const locked = computed(() => !hydrated.value || saving.value)
const draft = computed(() => ({ name: name.value.trim(), member_ids: memberIds.value }))
const nameError = computed(() => !draft.value.name ? t('inbox.settings.requiredName') : undefined)
const valid = computed(() => InboxDepartmentWriteSchema.safeParse(draft.value).success)
const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, index) => id === b[index])
const dirty = computed(() => !submitted.value && (name.value !== initialName.value || !sameIds(memberIds.value, initialMemberIds.value)))

function setMembers(value: number | number[] | null) {
  memberIds.value = Array.isArray(value) ? value : []
}

async function submit() {
  attempted.value = true
  if (locked.value || !valid.value) return
  failure.value = null
  try {
    await save({ id: props.department?.id, body: draft.value })
    initialName.value = name.value
    initialMemberIds.value = [...memberIds.value]
    submitted.value = true
    emit('done')
  } catch (error) {
    failure.value = error
  }
}
</script>

<template>
  <UForm :state="{ name, memberIds }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="inbox-department-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <UFormField :label="t('inbox.settings.name')" name="inbox-department-name" required :error="attempted ? nameError : undefined">
      <UInput id="inbox-department-name" v-model="name" class="w-full" maxlength="128" :disabled="locked" data-testid="inbox-department-name" />
    </UFormField>
    <UFormField :label="t('inbox.settings.departments.members')" name="inbox-department-members" :description="t('inbox.settings.departments.membersHint')">
      <SharedPersonPicker :model-value="memberIds" multiple value-key="user_id" :known="known" :disabled="locked" :aria-label="t('inbox.settings.departments.members')" @update:model-value="setMembers" />
    </UFormField>
    <SharedFormActions>
      <div class="ms-auto flex items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="saving" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="locked" :loading="saving" :label="department ? t('app.saveChanges') : t('app.create')" data-testid="inbox-department-save" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
