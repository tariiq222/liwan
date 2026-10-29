<script setup lang="ts">
import type { InboxDepartment } from '@webvue/contracts'
import InboxDepartmentHours from '@/components/inbox/InboxDepartmentHours.vue'
import { useDeleteInboxDepartment, useInboxDepartments, useSaveInboxDepartment } from '@/composables/inbox/useInboxSettings'

// Departments route conversations to the people who answer them; members are chosen from the company's people.
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxDepartments()
const { mutate: save, isPending: saving } = useSaveInboxDepartment()
const { mutate: remove, isPending: removing } = useDeleteInboxDepartment()
const items = computed(() => data.value?.items ?? [])

// `editing` is the row being edited, 0 for a new department, null for none.
const editing = ref<number | 0 | null>(null)
const name = ref('')
const memberIds = ref<number[]>([])
const known = ref<{ id: number; name: string }[]>([])
const deleting = ref<InboxDepartment | null>(null)
const nameError = computed(() => !name.value.trim() ? t('inbox.settings.requiredName') : undefined)
const attempted = ref(false)
const locked = computed(() => !hydrated.value || saving.value || removing.value)

function edit(department?: InboxDepartment) {
  editing.value = department?.id ?? 0
  name.value = department?.name ?? ''
  memberIds.value = department?.members.map(member => member.id) ?? []
  known.value = department?.members ?? []
  attempted.value = false
  deleting.value = null
}
function cancel() {
  editing.value = null
}
function setMembers(value: number | number[] | null) {
  memberIds.value = Array.isArray(value) ? value : []
}
function submit() {
  attempted.value = true
  if (locked.value || nameError.value) return
  save({ id: editing.value || undefined, body: { name: name.value.trim(), member_ids: memberIds.value } }, {
    onSuccess: () => { editing.value = null },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
function confirmDelete() {
  if (!deleting.value) return
  remove(deleting.value.id, {
    onSuccess: () => { deleting.value = null },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection id="departments" variant="panel" class="webvue-settings-anchor" :title="t('inbox.settings.departments.title')" :description="t('inbox.settings.departments.hint')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="locked" :label="t('inbox.settings.departments.add')" data-testid="inbox-department-add" @click="edit()" />
    </template>
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <div v-else class="flex flex-col gap-3">
      <form v-if="editing !== null" class="flex flex-col gap-3 rounded-control bg-elevated/50 p-3" novalidate @submit.prevent="submit">
        <UFormField :label="t('inbox.settings.name')" required :error="attempted ? nameError : undefined">
          <UInput v-model="name" class="w-full" maxlength="128" :disabled="locked" data-testid="inbox-department-name" />
        </UFormField>
        <UFormField :label="t('inbox.settings.departments.members')" :description="t('inbox.settings.departments.membersHint')">
          <SharedPersonPicker :model-value="memberIds" multiple value-key="user_id" :known="known" :disabled="locked" :aria-label="t('inbox.settings.departments.members')" @update:model-value="setMembers" />
        </UFormField>
        <InboxDepartmentHours v-if="editing && can('inbox.automation.manage')" :department-id="editing" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="locked" :label="t('app.cancel')" @click="cancel" />
          <UButton type="submit" :disabled="locked" :loading="saving" :label="t('app.save')" data-testid="inbox-department-save" />
        </div>
      </form>
      <SharedInlineConfirm
        v-if="deleting"
        :title="t('inbox.settings.departments.deleteTitle', { name: deleting.name })"
        :description="t('inbox.settings.departments.deleteDescription')"
        :confirm-label="t('inbox.settings.delete')"
        :pending="removing"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
      <p v-if="!items.length && editing === null" class="text-sm text-muted">{{ t('inbox.settings.departments.empty') }}</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="department in items" :key="department.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`inbox-department-${department.id}`">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">{{ department.name }}</p>
            <p class="truncate text-xs text-muted">{{ department.members.length ? department.members.map(member => member.name).join('، ') : t('inbox.settings.departments.noMembers') }}</p>
          </div>
          <div class="flex gap-1">
            <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-pencil" :disabled="locked" :aria-label="t('inbox.settings.edit', { name: department.name })" @click="edit(department)" />
            <UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :disabled="locked" :aria-label="t('inbox.settings.remove', { name: department.name })" @click="deleting = department; editing = null" />
          </div>
        </li>
      </ul>
    </div>
  </SharedRecordSection>
</template>
