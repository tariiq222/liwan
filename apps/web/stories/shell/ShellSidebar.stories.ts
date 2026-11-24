import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ShellSidebar from '@liwan/ui/app/components/shell/ShellSidebar.vue'
import ShellNavSection from '@liwan/ui/app/components/shell/ShellNavSection.vue'
import ShellOrgCard from '@liwan/ui/app/components/shell/ShellOrgCard.vue'
import ShellCoreApps from '@liwan/ui/app/components/shell/ShellCoreApps.vue'
import ShellAppTile from '@liwan/ui/app/components/shell/ShellAppTile.vue'
import ShellFooterBar from '@liwan/ui/app/components/shell/ShellFooterBar.vue'
import { appActionRows, appLinkRows, coreAppRows, footerRows, footerTools, pinnedRows } from '../fixtures/shell'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shell/ShellSidebar',
  component: ShellSidebar,
  parameters: { layout: 'fullscreen' },
  args: { label: 'القائمة الجانبية', brandName: 'منصة ليوان', caption: 'للشركات السعودية', homeTo: '/' },
} satisfies Meta<typeof ShellSidebar>
export default meta
type Story = StoryObj<typeof meta>

const components = { ShellSidebar, ShellNavSection, ShellOrgCard, ShellCoreApps, ShellAppTile, ShellFooterBar }
const context = storyContext('apps/web/app/components/shell/AppSidebar.vue:63')
const footer = `<template #footer><ShellFooterBar label="روابط عامة" :tools="footerTools" expand-label="عرض القائمة بالأسماء" collapse-label="إخفاء الأسماء"><ShellNavSection label="روابط عامة" :items="footerRows" /></ShellFooterBar></template>`

export const Global: Story = {
  name: 'عام',
  parameters: context,
  render: args => ({
    components, setup: () => ({ args, coreAppRows, pinnedRows, footerRows, footerTools }),
    template: `<div class="liwan-shell min-h-svh"><ShellSidebar v-bind="args" mode="global">
      <template #org><ShellOrgCard name="شركة الندى للتجارة" initial="ن" /></template>
      <template #core><ShellCoreApps label="التطبيقات الأساسية" :items="coreAppRows" /></template>
      <ShellNavSection label="تطبيقاتي" title="تطبيقاتي" :action="{ label: 'تعديل', to: '/apps', icon: 'i-lucide-pencil' }" :items="pinnedRows" />
      ${footer}
    </ShellSidebar></div>`,
  }),
}

export const Application: Story = {
  name: 'تطبيق مفتوح',
  parameters: context,
  render: args => ({
    components, setup: () => ({ args, appActionRows, appLinkRows, coreAppRows, footerRows, footerTools }),
    template: `<div class="liwan-shell min-h-svh"><ShellSidebar v-bind="args" mode="app">
      <template #org><ShellOrgCard name="شركة الندى للتجارة" initial="ن" /></template>
      <template #core><ShellCoreApps label="التطبيقات الأساسية" :items="coreAppRows" /></template>
      <div class="liwan-side-appblock"><ShellAppTile icon="i-lucide-folder-kanban" app="projects" size="md" /><span data-slot="name">المشاريع</span></div>
      <ShellNavSection label="إجراءات" :items="appActionRows" />
      <ShellNavSection label="المشاريع" title="المشاريع" :items="appLinkRows" />
      ${footer}
    </ShellSidebar></div>`,
  }),
}
