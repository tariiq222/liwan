<script setup lang="ts">
import { MIN_PASSWORD_LENGTH } from '@nasq/contracts'
const props = defineProps<{ open: boolean; pending?: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; submit: [password: string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const password = ref('')
const passwordTooShort = computed(() => password.value.trim().length > 0 && password.value.trim().length < MIN_PASSWORD_LENGTH)
watch(() => props.open, (open) => { if (!open) password.value = '' })
onBeforeUnmount(() => { password.value = '' })
function submit() {
  if (!hydrated.value || !password.value.trim() || passwordTooShort.value) return
  const value = password.value.trim()
  password.value = ''
  emit('submit', value)
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent>
      <DialogHeader><DialogTitle>{{ title || t('hr.employee.password') }}</DialogTitle></DialogHeader>
      <form class="grid gap-3" @submit.prevent="submit">
        <div class="grid gap-2"><Label for="hr-password">{{ t('hr.employee.password') }}</Label><Input id="hr-password" v-model="password" type="password" autocomplete="new-password" :disabled="!hydrated || pending" /><p v-if="passwordTooShort" class="text-sm text-destructive">{{ t('hr.employee.passwordMinLength', { count: MIN_PASSWORD_LENGTH }) }}</p></div>
        <DialogFooter><Button type="button" variant="outline" :disabled="pending" @click="emit('update:open', false)">{{ t('app.cancel') }}</Button><Button type="submit" :disabled="!hydrated || pending || !password.trim() || passwordTooShort">{{ t('app.save') }}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
