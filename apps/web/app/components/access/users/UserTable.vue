<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AdminUserSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'

const props = defineProps<{ users: AdminUserSummary[] }>()
const emit = defineEmits<{ open: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar

const columns = computed<TableColumn<AdminUserSummary>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('access.users.columns.name') },
  { accessorKey: 'login', header: t('access.users.columns.login') },
  { accessorKey: 'employee', header: t('access.users.columns.employee') },
  { accessorKey: 'roles', header: t('access.users.columns.roles') },
  { accessorKey: 'active', header: t('access.users.columns.status') },
  { accessorKey: 'actions', header: t('access.users.columns.actions') },
])
</script>

<template>
  <div class="min-w-0 space-y-2">
    <UCard class="hidden overflow-hidden md:block" :ui="{ body: 'p-0' }">
      <div class="overflow-x-auto">
        <UTable :data="users" :columns="columns" :caption="t('access.users.title')" :ui="{ caption: 'sr-only' }">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }"><span class="font-medium">{{ row.original.name }}</span></template>
          <template #login-cell="{ row }"><bdi dir="ltr">{{ row.original.login }}</bdi></template>
          <template #employee-cell="{ row }">{{ row.original.employee?.name ?? t('access.users.noEmployee') }}</template>
          <template #roles-cell="{ row }">{{ row.original.assignments.map((assignment) => roleLabel(assignment.role)).join('، ') || t('access.users.noRoles') }}</template>
          <template #active-cell="{ row }"><AccessStateBadge :active="row.original.active" :protected="row.original.protected" /></template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton color="secondary" variant="ghost" size="sm" :disabled="!hydrated" :label="t('access.view')" @click="emit('open', row.original.id)" />
            </div>
          </template>
        </UTable>
      </div>
    </UCard>
    <ul class="md:hidden space-y-2" :aria-label="t('access.users.title')">
      <li v-for="user in users" :key="user.id" class="nasq-ui-record-surface p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ user.id }}</bdi>
            <p class="font-medium">{{ user.name }}</p>
          </div>
          <AccessStateBadge :active="user.active" :protected="user.protected" />
        </div>
        <dl class="mt-3 grid grid-cols-1 gap-2 text-xs text-muted">
          <div><dt>{{ t('access.users.columns.login') }}</dt><dd dir="ltr">{{ user.login }}</dd></div>
          <div><dt>{{ t('access.users.columns.employee') }}</dt><dd>{{ user.employee?.name ?? t('access.users.noEmployee') }}</dd></div>
          <div><dt>{{ t('access.users.columns.roles') }}</dt><dd>{{ user.assignments.map((assignment) => roleLabel(assignment.role)).join('، ') || t('access.users.noRoles') }}</dd></div>
        </dl>
        <div class="mt-3 flex justify-end">
          <UButton color="secondary" variant="ghost" size="sm" :disabled="!hydrated" :label="t('access.view')" @click="emit('open', user.id)" />
        </div>
      </li>
    </ul>
  </div>
</template>
