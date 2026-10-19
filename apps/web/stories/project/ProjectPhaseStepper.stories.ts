import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ProjectPhaseStepper from '../../app/components/pmo/projects/ProjectPhaseStepper.vue'
import { storyContext } from '../support/context'

// The five lifecycle steps in the project header; on a phone only the current step and "n من 5" show.
const meta = {
  title: 'Project/ProjectPhaseStepper',
  component: ProjectPhaseStepper,
  parameters: { layout: 'padded', ...storyContext('apps/web/app/pages/projects/[id].vue:113') },
  args: { current: 'initiating' },
} satisfies Meta<typeof ProjectPhaseStepper>
export default meta
type Story = StoryObj<typeof meta>

export const Initiating: Story = { name: 'البدء', parameters: storyContext('apps/web/app/pages/projects/[id].vue:113', 'أول خطوة، لا خطوات منجزة.') }
export const Executing: Story = { name: 'التنفيذ', args: { current: 'executing' }, parameters: storyContext('apps/web/app/pages/projects/[id].vue:113', 'الخطوات السابقة معلّمة بعلامة صح.') }
export const Closed: Story = { name: 'مغلق', args: { current: 'closed' }, parameters: storyContext('apps/web/app/pages/projects/[id].vue:113', 'كل الخطوات منجزة ما عدا الأخيرة الحالية.') }
