import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import ProjectGovernanceTabs from '../../app/components/project/workspace/ProjectGovernanceTabs.vue'
import ProjectWorkspaceTabs from '../../app/components/project/workspace/ProjectWorkspaceTabs.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Project/ProjectGovernanceTabs',
  component: ProjectGovernanceTabs,
  args: { projectId: 1 },
  parameters: storyContext('apps/web/app/pages/projects/[id].vue:75', 'تبويبات الحوكمة الفرعية تحت صفّ أقسام المشروع، بنفس الخط المستقيم. تظهر في كل صفحات الحوكمة وسجلاتها.'),
  render: args => ({
    components: { ProjectGovernanceTabs, ProjectWorkspaceTabs },
    setup: () => {
      const router = useRouter()
      onMounted(() => router.push('/projects/1/stakeholders'))
      return { args }
    },
    template: '<div class="flex flex-col"><ProjectWorkspaceTabs :project-id="args.projectId" :active="true" /><ProjectGovernanceTabs v-bind="args" /></div>',
  }),
} satisfies Meta<typeof ProjectGovernanceTabs>
export default meta
type Story = StoryObj<typeof meta>

export const Stakeholders: Story = { name: 'أصحاب المصلحة' }
