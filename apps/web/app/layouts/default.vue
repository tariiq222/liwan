<script setup lang="ts">
const { t, localeProperties } = useI18n()
const route = useRoute()
const pageHeader = useShellPageHeader()

const fallbackLabels: Array<[RegExp, string]> = [
  [/^\/projects(?:\/|$)/, 'nav.projects'],
  [/^\/(?:archived-)?tasks(?:\/|$)/, 'nav.tasks'],
  [/^\/hr\/departments(?:\/|$)/, 'nav.departments'],
  [/^\/hr\/documents(?:\/|$)/, 'nav.documents'],
  [/^\/hr(?:\/|$)/, 'nav.employees'],
  [/^\/settings\/users(?:\/|$)/, 'nav.users'],
  [/^\/settings\/roles(?:\/|$)/, 'nav.roles'],
  [/^\/settings\/access-log(?:\/|$)/, 'nav.accessLog'],
  [/^\/settings\/projects(?:\/|$)/, 'nav.projectSettings'],
  [/^\/settings\/branding(?:\/|$)/, 'nav.branding'],
  [/^\/settings\/appearance(?:\/|$)/, 'settings.appearance.title'],
  [/^\/account(?:\/|$)/, 'nav.account'],
  [/^\/search(?:\/|$)/, 'app.search'],
  [/^\/notifications(?:\/|$)/, 'notifications.title'],
  [/^\/reports(?:\/|$)/, 'pages.reports'],
]
const fallbackLabelKey = computed(() => fallbackLabels.find(([pattern]) => pattern.test(route.path))?.[1] ?? 'app.productName')
const shellTitle = computed(() => pageHeader.title.value?.trim() || t(fallbackLabelKey.value))
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
</script>

<template>
  <div data-nasq-shell class="nasq-shell" :data-direction="dir">
    <ShellHeader />
    <AppSidebar />
    <div class="nasq-shell-workspace">
      <ShellBreadcrumb />
      <main data-testid="shell-main" class="nasq-shell-main">
        <div class="nasq-shell-page-title sr-only" aria-live="polite">{{ shellTitle }}</div>
        <slot />
      </main>
    </div>
    <Toaster :dir="dir" />
  </div>
</template>
