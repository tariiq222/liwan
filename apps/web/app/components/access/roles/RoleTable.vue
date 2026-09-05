<script setup lang="ts">
import type { RoleSummary } from '@nasq/contracts'
import AccessStateBadge from '@/components/access/AccessStateBadge.vue'

defineProps<{ roles: RoleSummary[]; canManage?: boolean }>()
defineEmits<{ open: [id: number]; clone: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div class="overflow-x-auto rounded-lg border">
    <table class="w-full min-w-[680px] text-sm">
      <thead class="border-b bg-muted/30">
        <tr>
          <th class="p-3 text-start font-medium">{{ t('access.roles.columns.name') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.roles.columns.description') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.roles.columns.type') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.roles.columns.users') }}</th>
          <th class="p-3 text-start font-medium">{{ t('access.roles.columns.status') }}</th>
          <th class="p-3 text-end font-medium">{{ t('access.roles.columns.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in roles" :key="role.id" class="border-b last:border-0">
          <td class="p-3 font-medium">{{ role.name.ar }}</td>
          <td class="max-w-xs p-3">{{ role.description }}</td>
          <td class="p-3">{{ role.type === 'built_in' ? t('access.roles.builtIn') : t('access.roles.custom') }}</td>
          <td class="p-3">{{ role.user_count }}</td>
          <td class="p-3"><AccessStateBadge :active="role.active" :protected="role.protected" /></td>
          <td class="flex justify-end gap-1 p-3">
            <Button variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('open', role.id)">{{ t('access.view') }}</Button>
            <Button v-if="canManage" variant="ghost" size="sm" :disabled="!hydrated" @click="$emit('clone', role.id)">{{ t('access.roles.clone') }}</Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
