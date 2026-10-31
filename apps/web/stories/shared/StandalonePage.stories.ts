import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { useI18n } from 'vue-i18n'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import ShellFrame from '@liwan/ui/app/components/shell/ShellFrame.vue'
import ShellHeader from '../../app/components/shell/ShellHeader.vue'
import BrandWordmark from '@liwan/ui/app/components/shared/layout/BrandWordmark.vue'
import StandalonePage from '@liwan/ui/app/components/shared/layout/StandalonePage.vue'
import { __getRouter } from '../../.storybook/nuxt-shims'
import { shellHandlers } from '../handlers/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/StandalonePage',
  component: StandalonePage,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('unused', 'صفحة خارج إطار التطبيق: `card` بطاقة في وسط الصفحة (الدخول، الدعوة، صفحة الخطأ)، و`print` وثيقة تُطبع أسود على أبيض بلا إطار التطبيق، وتذييلها لا يُطبع.'),
  },
  args: { variant: 'card' },
} satisfies Meta<typeof StandalonePage>
export default meta
type Story = StoryObj<typeof meta>

const DOCUMENT = `
  <dl class="grid gap-3 sm:grid-cols-2">
    <div class="grid gap-1 rounded-control p-3 ring ring-default"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.date') }}</dt><dd dir="ltr" class="text-highlighted">2026-10-05</dd></div>
    <div class="grid gap-1 rounded-control p-3 ring ring-default"><dt class="text-xs text-muted">{{ t('meetingMinutesForm.chairperson') }}</dt><dd class="text-highlighted">سارة القحطاني</dd></div>
  </dl>
  <p class="text-sm leading-7 text-default">اطّلع المجتمعون على خطة الربع الرابع، واتفقوا على مراجعة الميزانية قبل نهاية الشهر وتوزيع المهام على الفرق.</p>
  <template #footer>
    <UButton color="neutral" variant="outline" :label="t('app.back')" />
    <UButton icon="i-lucide-printer" :label="t('meetingMinutesForm.print')" />
  </template>`

export const Card: Story = {
  name: 'بطاقة',
  render: () => ({
    components: { StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<StandalonePage :title="t('auth.signIn')">
      <form class="grid gap-4" @submit.prevent>
        <UFormField :label="t('auth.username')" name="login"><UInput id="story-login" class="w-full" dir="ltr" autocomplete="username" /></UFormField>
        <UFormField :label="t('auth.password')" name="password"><UInput id="story-password" type="password" class="w-full" dir="ltr" autocomplete="current-password" /></UFormField>
        <UButton type="submit" class="w-full justify-center" :label="t('auth.signIn')" />
      </form>
    </StandalonePage>`,
  }),
}

export const WithBrandHeader: Story = {
  name: 'بطاقة برأس الهوية',
  args: { variant: 'card' },
  render: args => ({
    components: { StandalonePage },
    setup: () => ({ args, t: useI18n().t }),
    template: `<StandalonePage v-bind="args">
      <template #header>
        <div class="flex flex-col items-center text-center">
          <span class="mb-3 grid size-12 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">ن</span>
          <h1 class="text-2xl font-semibold text-highlighted">{{ t('app.productName') }}</h1>
          <p class="text-sm text-muted">{{ t('auth.signInToContinue') }}</p>
        </div>
      </template>
      <p class="text-sm text-muted">{{ t('auth.username') }}</p>
    </StandalonePage>`,
  }),
}

export const BrandSurface: Story = {
  name: 'بطاقة على سطح الهوية',
  parameters: storyContext('unused', 'سطح لافندر كامل خارج التطبيق (صفحة الدخول)، الشعار الأبيض عليه فوق بطاقة بيضاء.'),
  render: () => ({
    components: { StandalonePage, BrandWordmark },
    setup: () => ({ t: useI18n().t }),
    template: `<StandalonePage surface="brand">
      <template #brand><BrandWordmark size="xl" inverted /></template>
      <template #header>
        <div class="flex flex-col items-center text-center">
          <h1 class="text-2xl font-semibold text-highlighted">{{ t('app.productName') }}</h1>
          <p class="text-sm text-muted">{{ t('auth.signInToContinue') }}</p>
        </div>
      </template>
      <form class="grid gap-4" @submit.prevent>
        <UFormField :label="t('auth.username')" name="login"><UInput id="story-brand-login" class="w-full" dir="ltr" autocomplete="username" /></UFormField>
        <UButton type="submit" class="w-full justify-center" :label="t('auth.signIn')" />
      </form>
    </StandalonePage>`,
  }),
}

export const Print: Story = {
  name: 'وثيقة للطباعة',
  render: () => ({
    components: { StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<main class="liwan-shell-main"><StandalonePage variant="print" :title="t('meetingMinutesForm.documentTitle')">${DOCUMENT}</StandalonePage></main>`,
  }),
}

export const PrintInShell: Story = {
  name: 'وثيقة للطباعة داخل الإطار',
  parameters: { msw: { handlers: { api: shellHandlers } } },
  loaders: [async () => { await __getRouter()!.replace('/tasks'); return {} }],
  render: () => ({
    components: { AppSidebar, ShellFrame, ShellHeader, StandalonePage },
    setup: () => ({ t: useI18n().t }),
    template: `<ShellFrame>
      <template #header><ShellHeader /></template>
      <template #sidebar><AppSidebar /></template>
      <main class="liwan-shell-main" data-testid="shell-main"><StandalonePage variant="print" :title="t('meetingMinutesForm.documentTitle')">${DOCUMENT}</StandalonePage></main>
    </ShellFrame>`,
  }),
}
