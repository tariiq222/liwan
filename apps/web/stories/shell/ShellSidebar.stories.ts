import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellSidebar from '@liwan/ui/app/components/shell/ShellSidebar.vue'
import ShellNavSection from '@liwan/ui/app/components/shell/ShellNavSection.vue'
import ShellOrgCard from '@liwan/ui/app/components/shell/ShellOrgCard.vue'
import ShellAccountCard from '@liwan/ui/app/components/shell/ShellAccountCard.vue'
import ShellAppTile from '@liwan/ui/app/components/shell/ShellAppTile.vue'
import { allAppsRows, appActionRows, appLinkRows, dayRows, pinnedRows } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellSidebar',
  component: ShellSidebar,
  parameters: { layout: 'fullscreen' },
  args: { label: 'القائمة الجانبية', brandName: 'منصة ليوان', caption: 'للشركات السعودية', homeTo: '/' },
} satisfies Meta<typeof ShellSidebar>
export default meta
type Story = StoryObj<typeof meta>

const components = { ShellSidebar, ShellNavSection, ShellOrgCard, ShellAccountCard, ShellAppTile }
const context = storyContext('apps/web/app/components/shell/AppSidebar.vue:58')
const footer = `<template #footer><ShellAccountCard name="سارة العتيبي" initial="س" caption="مديرة المبيعات" to="/account" :connected="true" label="الخدمة الذاتية: سارة العتيبي" /></template>`

export const Global: Story = {
  name: 'عام',
  parameters: context,
  render: args => ({
    components, setup: () => ({ args, dayRows, pinnedRows, allAppsRows }),
    template: `<div class="liwan-shell min-h-svh"><ShellSidebar v-bind="args" mode="global">
      <template #org><ShellOrgCard name="شركة الندى للتجارة" initial="ن" /></template>
      <ShellNavSection label="يومي" :items="dayRows" />
      <ShellNavSection label="تطبيقاتي" title="تطبيقاتي" :action="{ label: 'تعديل', to: '/apps' }" :items="pinnedRows" />
      <ShellNavSection label="كل التطبيقات" :items="allAppsRows" />
      ${footer}
    </ShellSidebar></div>`,
  }),
}

export const Application: Story = {
  name: 'تطبيق مفتوح',
  parameters: context,
  render: args => ({
    components, setup: () => ({ args, appActionRows, appLinkRows }),
    template: `<div class="liwan-shell min-h-svh"><ShellSidebar v-bind="args" mode="app">
      <div class="liwan-side-back"><ShellNavSection label="كل التطبيقات" :items="[{ id: 'back', label: 'كل التطبيقات', icon: 'i-lucide-arrow-left', to: '/apps', active: false, testId: 'back' }]" /></div>
      <div class="liwan-side-appblock"><ShellAppTile icon="i-lucide-folder-kanban" app="projects" size="md" /><span data-slot="name">المشاريع</span></div>
      <ShellNavSection label="إجراءات" :items="appActionRows" />
      <ShellNavSection label="المشاريع" title="المشاريع" :items="appLinkRows" />
      ${footer}
    </ShellSidebar></div>`,
  }),
}
