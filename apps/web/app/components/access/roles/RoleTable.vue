<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RoleSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import type { RowAction } from '@/components/shared/RowActions.vue'
import { builtinRoleDescription } from '@/utils/labelFallback'

const props = defineProps<{ roles: RoleSummary[]; canManage?: boolean }>()
const emit = defineEmits<{ open: [id: number]; clone: [id: number] }>()
const { t, te, locale } = useI18n()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
const roleDescription = (role: RoleSummary) => builtinRoleDescription(role, t, te)

function actionsFor(role: RoleSummary): RowAction[] {
  return [
    { label: t('access.view'), icon: 'i-lucide-eye', onSelect: () => emit('open', role.id) },
    ...(props.canManage ? [{ label: t('access.roles.clone'), icon: 'i-lucide-copy', onSelect: () => emit('clone', role.id) } satisfies RowAction] : []),
  ]
}

const columns = computed<TableColumn<RoleSummary>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('access.roles.columns.name') },
  { accessorKey: 'description', header: t('access.roles.columns.description') },
  { accessorKey: 'type', header: t('access.roles.columns.type') },
  { accessorKey: 'user_count', header: t('access.roles.columns.users') },
  { accessorKey: 'active', header: t('access.roles.columns.status') },
  { accessorKey: 'actions', header: t('access.roles.columns.actions') },
])
</script>

<template>
  <div class="min-w-0 space-y-2">
    <div class="hidden overflow-hidden rounded-lg bg-default ring ring-default md:block">
      <div class="overflow-x-auto">
        <UTable :data="roles" :columns="columns" :caption="t('access.roles.title')" :ui="{ caption: 'sr-only', th: '' }">
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
          <template #name-cell="{ row }"><span class="font-medium">{{ roleLabel(row.original) }}</span></template>
          <template #description-cell="{ row }"><span class="max-w-xs whitespace-normal">{{ roleDescription(row.original) }}</span></template>
          <template #type-cell="{ row }">{{ row.original.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom') }}</template>
          <template #user_count-cell="{ row }">{{ row.original.user_count }}</template>
          <template #active-cell="{ row }"><AccessStateBadge :active="row.original.active" :protected="row.original.protected" /></template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end"><SharedRowActions :actions="actionsFor(row.original)" :label="t('access.roles.rowActions', { name: roleLabel(row.original) })" /></div>
          </template>
        </UTable>
      </div>
    </div>
    <ul class="divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default md:hidden" :aria-label="t('access.roles.title')">
      <li v-for="role in roles" :key="role.id" class="p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <bdi class="block text-xs text-muted">#{{ role.id }}</bdi>
            <p class="font-medium">{{ roleLabel(role) }}</p>
          </div>
          <AccessStateBadge :active="role.active" :protected="role.protected" />
        </div>
        <p class="mt-2 text-xs text-muted">{{ roleDescription(role) }}</p>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
          <div><dt>{{ t('access.roles.columns.type') }}</dt><dd>{{ role.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom') }}</dd></div>
          <div><dt>{{ t('access.roles.columns.users') }}</dt><dd>{{ role.user_count }}</dd></div>
        </dl>
        <div class="mt-3 flex justify-end">
          <SharedRowActions :actions="actionsFor(role)" :label="t('access.roles.rowActions', { name: roleLabel(role) })" />
        </div>
      </li>
    </ul>
  </div>
</template>
