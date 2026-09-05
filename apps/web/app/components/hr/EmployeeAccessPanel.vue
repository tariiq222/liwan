<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useGrantHrAccess, useRevokeHrAccess, useUpdateHrAccess, type HrEmployee } from '@/composables/useHrEmployees'
import AccessBadge from './AccessBadge.vue'
import SetPasswordDialog from './SetPasswordDialog.vue'

const props = defineProps<{ employee: HrEmployee }>()
const { t } = useI18n(); const hydrated = useHydrated()
const passwordOpen = ref(false); const revokeOpen = ref(false); const role = ref<'employee' | 'admin'>('employee'); const originalRole = ref<'employee' | 'admin'>('employee')
const { mutateAsync: grant, isPending: granting } = useGrantHrAccess()
const { mutateAsync: update, isPending: updating } = useUpdateHrAccess()
const { mutateAsync: revoke, isPending: revoking } = useRevokeHrAccess()
const pending = computed(() => granting.value || updating.value || revoking.value)
const vendor = computed(() => props.employee.access?.role === 'vendor')
const needsGrant = computed(() => !props.employee.access?.active)
const canSetPassword = computed(() => props.employee.active && (!needsGrant.value || !!props.employee.work_email.trim()) && !vendor.value)
const blockedReason = computed(() => !props.employee.active ? t('hr.employee.accessArchived') : needsGrant.value && !props.employee.work_email.trim() ? t('hr.employee.accessNeedsEmail') : '')
const roleChanged = computed(() => role.value !== originalRole.value)
watch(() => props.employee.access, (access) => { role.value = access?.role === 'admin' ? 'admin' : 'employee'; originalRole.value = role.value }, { immediate: true })
async function savePassword(password: string) {
  try {
    if (props.employee.access?.active) await update({ id: props.employee.id, body: { password } })
    else await grant({ id: props.employee.id, body: { password, role: role.value } })
    passwordOpen.value = false; toast.success(t('hr.employee.accessSaved'))
  } catch (error) { toast.error(error instanceof Error ? error.message : t('errors.generic')) }
}
function selectRole(value: unknown) { if (!vendor.value && hydrated.value) role.value = value === 'admin' ? 'admin' : 'employee' }
async function saveRole() {
  if (!props.employee.access?.active || vendor.value || !hydrated.value || !roleChanged.value) return
  const previous = originalRole.value
  try { await update({ id: props.employee.id, body: { role: role.value } }); originalRole.value = role.value; toast.success(t('hr.employee.accessSaved')) }
  catch (error) { role.value = previous; toast.error(error instanceof Error ? error.message : t('errors.generic')) }
}
async function confirmRevoke() {
  if (!hydrated.value) return
  try { await revoke({ id: props.employee.id }); revokeOpen.value = false; toast.success(t('hr.employee.accessRevoked')) }
  catch (error) { toast.error(error instanceof Error ? error.message : t('errors.generic')) }
}
</script>

<template>
  <div class="grid gap-4">
    <div class="flex items-center justify-between"><span class="text-sm text-muted-foreground">{{ t('hr.employee.account') }}</span><AccessBadge :access="employee.access" /></div>
    <p v-if="vendor" class="text-sm text-muted-foreground">{{ t('hr.employee.vendorReadOnly') }}</p>
    <template v-if="!vendor">
      <div class="grid gap-2"><Label>{{ t('hr.employee.role') }}</Label><Select :model-value="role" :disabled="!hydrated || pending" @update:model-value="selectRole"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="employee">{{ t('hr.directory.access.employee') }}</SelectItem><SelectItem value="admin">{{ t('hr.directory.access.admin') }}</SelectItem></SelectContent></Select><Button v-if="employee.access?.active" variant="outline" :disabled="!hydrated || pending || !roleChanged" @click="saveRole">{{ t('hr.employee.saveRole') }}</Button></div>
      <p v-if="blockedReason" class="text-sm text-muted-foreground">{{ blockedReason }}</p>
      <div class="flex flex-wrap gap-2"><Button :disabled="!hydrated || pending || !canSetPassword" @click="passwordOpen = true">{{ employee.access?.active ? t('hr.employee.changePassword') : t('hr.employee.grantAccess') }}</Button><Button v-if="employee.access?.active" variant="destructive" :disabled="!hydrated || pending" @click="revokeOpen = true">{{ t('hr.employee.revokeAccess') }}</Button></div>
    </template>
    <SetPasswordDialog v-model:open="passwordOpen" :pending="pending" @submit="savePassword" />
    <Dialog :open="revokeOpen" @update:open="revokeOpen = $event"><DialogContent><DialogHeader><DialogTitle>{{ t('hr.employee.revokeAccess') }}</DialogTitle><DialogDescription>{{ t('hr.employee.revokeConfirm') }}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" :disabled="pending" @click="revokeOpen = false">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="!hydrated || pending" @click="confirmRevoke">{{ t('hr.employee.revokeAccess') }}</Button></DialogFooter></DialogContent></Dialog>
  </div>
</template>
