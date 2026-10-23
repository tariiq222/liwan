import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentContextField from '../../app/components/documents/DocumentContextField.vue'
import PageContainer from '@webvue/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'
import { document, access, documentHandlers } from './fixtures'
const meta = {
  title: 'Documents/DocumentContextField', component: DocumentContextField,
  parameters: { layout: 'fullscreen', msw: { handlers: { documents: documentHandlers } } },
  args: { modelValue: { kind: 'hr.department', id: 1 } },
} satisfies Meta<typeof DocumentContextField>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  parameters: storyContext('apps/web/app/components/documents/DocumentMetadataFields.vue:34'),
  render: args => ({ components: { DocumentContextField, PageContainer }, setup: () => ({ args }), template: '<main class="webvue-shell-main"><PageContainer width="form"><DocumentContextField v-bind="args" /></PageContainer></main>' }),
}

export const Employee: Story = { ...Default, args: { modelValue: { kind: 'hr.employee', id: 1 } } }
