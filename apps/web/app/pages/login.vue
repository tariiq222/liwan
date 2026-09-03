<script setup lang="ts">
definePageMeta({ layout: false })

const { branding } = useBranding()
const route = useRoute()
const login = ref('')
const password = ref('')
const pending = ref(false)
const errorMessage = ref<string | null>(null)
// Guards the form so inputs/button stay disabled (and Playwright/native
// interaction waits) until the client has hydrated — interacting before
// hydration would otherwise race Vue's own v-model mount sync and either
// fall through to a native, unhandled form submission or have typed values
// clobbered when hydration reaches that node.
const mounted = ref(false)
onMounted(() => { mounted.value = true })

async function submit() {
  pending.value = true
  errorMessage.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { login: login.value, password: password.value } })
    await refreshNuxtData('me')
    await navigateTo((route.query.next as string) || '/')
  } catch (e: any) {
    errorMessage.value = e?.data?.data?.message ?? 'تعذّر تسجيل الدخول'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="min-h-svh grid place-items-center bg-muted/40 p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="h-12 w-auto mb-2" />
        <CardTitle class="text-xl">{{ branding?.name ?? 'nasq' }}</CardTitle>
        <CardDescription>سجّل الدخول للمتابعة</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="login">اسم المستخدم</Label>
            <Input id="login" v-model="login" autocomplete="username" required dir="ltr" class="text-start" :disabled="!mounted" />
          </div>
          <div class="grid gap-2">
            <Label for="password">كلمة المرور</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required dir="ltr" :disabled="!mounted" />
          </div>
          <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
          <Button type="submit" class="w-full" :disabled="pending || !mounted">دخول</Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>
