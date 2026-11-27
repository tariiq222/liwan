<script setup lang="ts">
import type { InboxDepartment } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useDeleteInboxDepartment, useInboxDepartments } from '@/composables/inbox/useInboxSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Departments route conversations to the people who answer them; creating opens the route-backed create panel and
// editing opens the department's edit page.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('inbox.settings.manage'))
const { data, isLoading, error, refetch } = useInboxDepartments()
const { mutateAsync: remove, isPending: removing } = useDeleteInboxDepartment()
const items = computed(() => data.value?.items ?? [])
const deleting = ref<InboxDepartment | null>(null)
const deleteError = ref('')
const locked = computed(() => !hydrated.value || removing.value)

const rowActions = (department: InboxDepartment): RowAction[] => canManage.value
  ? [
      {
        label: t('app.edit'),
        icon: 'i-lucide-pencil',
        to: { path: `/settings/apps/inbox/departments/${department.id}/edit`, query: returnToQuery(route.fullPath) },
      },
      {
        label: t('inbox.settings.delete'),
        icon: 'i-lucide-trash-2',
        destructive: true,
        onSelect: () => {
          deleteError.value = ''
          deleting.value = department
        },
      },
    ]
  : []

async function confirmDelete() {
  if (!deleting.value || !canManage.value || removing.value) return
  deleteError.value = ''
  try {
    await remove(deleting.value.id)
    deleting.value = null
  } catch (e) {
    deleteError.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <SharedRecordSection id="departments" variant="panel" class="liwan-settings-anchor" :title="t('inbox.settings.departments.title')" :description="t('inbox.settings.departments.hint')">
    <template #actions>
      <UButton
        v-if="canManage"
        :to="{ path: '/settings/apps/inbox/departments/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('inbox.settings.departments.add')"
        data-testid="inbox-department-add"
      />
      <UBadge v-else color="neutral" variant="subtle" :label="t('app.viewOnly')" />
    </template>
    <SharedPageState :loading="isLoading" :error="data ? null : error" :empty="false" @retry="refetch()">
      <div class="flex flex-col gap-3">
        <UAlert v-if="deleteError" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="deleteError" />
        <SharedInlineConfirm
          v-if="deleting"
          :title="t('inbox.settings.departments.deleteTitle', { name: deleting.name })"
          :description="t('inbox.settings.departments.deleteDescription')"
          :confirm-label="t('inbox.settings.delete')"
          :pending="removing"
          @confirm="confirmDelete"
          @cancel="deleting = null"
        />
        <p v-if="!items.length" class="text-sm text-muted">{{ t('inbox.settings.departments.empty') }}</p>
        <ul v-else class="divide-y divide-default">
          <li v-for="department in items" :key="department.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`inbox-department-${department.id}`">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">{{ department.name }}</p>
              <p class="truncate text-xs text-muted">{{ department.members.length ? joinList(department.members.map(member => member.name), t) : t('inbox.settings.departments.noMembers') }}</p>
            </div>
            <SharedRowActions v-if="rowActions(department).length" :actions="rowActions(department)" :label="t('inbox.settings.departments.actionsNamed', { name: department.name })" :disabled="locked" />
          </li>
        </ul>
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
