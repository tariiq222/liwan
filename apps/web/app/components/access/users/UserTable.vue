<script setup lang="ts">
import type { AdminUserSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'

defineProps<{ users: AdminUserSummary[] }>()
defineEmits<{ open: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const roleLabel = (role: { name: { ar: string; en: string | null } }) => role.name[locale.value === 'ar' ? 'ar' : 'en'] ?? role.name.ar
</script>

<template>
  <div class="nasq-panel overflow-hidden">
    <div class="overflow-x-auto">
      <Table class="nasq-settings-table">
        <TableHeader>
          <TableRow>
            <TableHead class="w-28 text-start">{{ t('app.recordNumber') }}</TableHead>
            <TableHead class="text-start">{{ t('access.users.columns.name') }}</TableHead>
            <TableHead class="text-start">{{ t('access.users.columns.login') }}</TableHead>
            <TableHead class="text-start">{{ t('access.users.columns.employee') }}</TableHead>
            <TableHead class="text-start">{{ t('access.users.columns.roles') }}</TableHead>
            <TableHead class="text-start">{{ t('access.users.columns.status') }}</TableHead>
            <TableHead class="text-end">{{ t('access.users.columns.actions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="user in users" :key="user.id">
            <TableCell class="w-28"><RecordNumber :value="user.id" /></TableCell>
            <TableCell class="font-medium">{{ user.name }}</TableCell>
            <TableCell dir="ltr">{{ user.login }}</TableCell>
            <TableCell>{{ user.employee?.name ?? t('access.users.noEmployee') }}</TableCell>
            <TableCell>{{ user.assignments.map((assignment) => roleLabel(assignment.role)).join('، ') || t('access.users.noRoles') }}</TableCell>
            <TableCell><AccessStateBadge :active="user.active" :protected="user.protected" /></TableCell>
            <TableCell class="text-end">
              <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', user.id)">{{ t('access.view') }}</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
