import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentAccessForm from '../../app/components/documents/DocumentAccessForm.vue'
import PageContainer from '@liwan/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentAccessForm', component: DocumentAccessForm,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { access, pending: false, backTo: '/documents/8' },
} satisfies Meta<typeof DocumentAccessForm>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/pages/documents/[documentId]/access.vue:25'),
  render: args => ({ components: { DocumentAccessForm, PageContainer }, setup: () => ({ args }), template: '<main class="liwan-shell-main"><PageContainer width="form"><DocumentAccessForm v-bind="args" /></PageContainer></main>' }),
}

export const Company: Story = { ...Default, args: { access: { ...access, visibility: 'company' } } }
export const LastEditor: Story = { ...Default, args: { access: { ...access, grants: [access.grants[0]!] } } }
export const Conflict: Story = { ...Default, args: { conflict: true } }
