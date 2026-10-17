import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { ProjectDetail } from '@webvue/contracts'
import ProjectPhaseGate from '../../app/components/pmo/projects/ProjectPhaseGate.vue'
import { projectDetail } from '../fixtures/pmo'
import { storyContext } from '../support/context'

// The gate into the next phase on the project summary: the checks with a fix link, then the move
// and step-back actions for managers.
const ctx = (note?: string) => storyContext('apps/web/app/pages/projects/[id]/index.vue:50', note)
const withPhase = (phase_state: ProjectDetail['phase_state'], rest: Partial<ProjectDetail> = {}): ProjectDetail =>
  ({ ...projectDetail, can_manage: true, ...rest, phase_state })

const meta = {
  title: 'Project/ProjectPhaseGate',
  component: ProjectPhaseGate,
  parameters: { layout: 'padded', ...ctx() },
  args: { project: withPhase({ current: 'initiating', next: 'planning', previous: null, next_checks: [{ key: 'charter_approved', ok: false }] }) },
} satisfies Meta<typeof ProjectPhaseGate>
export default meta
type Story = StoryObj<typeof meta>

export const Blocked: Story = { name: 'محجوب بشرط', parameters: ctx('الانتقال معطّل ورابط استكمال الميثاق ظاهر.') }
export const Ready: Story = {
  name: 'جاهز للانتقال',
  args: { project: withPhase({ current: 'initiating', next: 'planning', previous: null, next_checks: [{ key: 'charter_approved', ok: true }] }) },
  parameters: ctx('كل الشروط متحققة.'),
}
export const WithBack: Story = {
  name: 'مع رجوع',
  args: { project: withPhase({ current: 'executing', next: 'closing', previous: 'planning', next_checks: [] }) },
  parameters: ctx('الرجوع يطلب تأكيدًا مضمّنًا.'),
}
export const ReadOnly: Story = {
  name: 'قارئ بلا صلاحية',
  args: { project: withPhase({ current: 'initiating', next: 'planning', previous: null, next_checks: [{ key: 'charter_approved', ok: false }] }, { can_manage: false }) },
  parameters: ctx('الشروط تُعرض بلا أزرار.'),
}
export const Closed: Story = {
  name: 'مغلق',
  args: { project: withPhase({ current: 'closed', next: null, previous: 'closing', next_checks: [] }) },
  parameters: ctx('المشروع مغلق.'),
}
