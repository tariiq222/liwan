<script setup lang="ts">
import type { RoleSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'

defineProps<{ roles: RoleSummary[]; canManage?: boolean }>()
defineEmits<{ open: [id: number]; clone: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div class="nasq-panel overflow-hidden">
    <div class="overflow-x-auto">
      <Table class="min-w-[680px]">
        <TableHeader>
          <TableRow>
            <TableHead class="text-start">{{ t('access.roles.columns.name') }}</TableHead>
            <TableHead class="text-start">{{ t('access.roles.columns.description') }}</TableHead>
            <TableHead class="text-start">{{ t('access.roles.columns.type') }}</TableHead>
            <TableHead class="text-start">{{ t('access.roles.columns.users') }}</TableHead>
            <TableHead class="text-start">{{ t('access.roles.columns.status') }}</TableHead>
            <TableHead class="text-end">{{ t('access.roles.columns.actions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="role in roles" :key="role.id">
            <TableCell class="font-medium">{{ role.name.ar }}</TableCell>
            <TableCell class="max-w-xs whitespace-normal">{{ role.description }}</TableCell>
            <TableCell>{{ role.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom') }}</TableCell>
            <TableCell>{{ role.user_count }}</TableCell>
            <TableCell><AccessStateBadge :active="role.active" :protected="role.protected" /></TableCell>
            <TableCell class="text-end">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', role.id)">{{ t('access.view') }}</Button>
                <Button v-if="canManage" variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('clone', role.id)">{{ t('access.roles.clone') }}</Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
