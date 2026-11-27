import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LauncherAddonRow from '../../app/components/launcher/LauncherAddonRow.vue'
import { storyContext } from '../support/context'

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const baseAddon = {
  bundleId: 'bundle-hr-v1',
  appId: 'hr',
  icon: 'i-lucide-users' as const,
  labelKey: 'nav.hr',
  descriptionKey: 'launcher.apps.hr.description',
  nameAr: 'الموارد البشرية',
  nameEn: 'People',
  fallbackDescription: 'شؤون الموظفين وسجلاتهم، والاستقطاب والتوظيف، والدوام والإجازات، والرواتب والتأمينات.',
  primaryPrice: { cadence: { unit: 'month' as const, count: 1 }, amount: sar(29900) },
  secondaryPrice: { cadence: { unit: 'year' as const, count: 1 }, amount: sar(299000) },
}

const meta = {
  title: 'Launcher/LauncherAddonRow',
  component: LauncherAddonRow,
  parameters: {
    layout: 'padded',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/pages/apps/index.vue:48', 'صف تطبيق متاح للإضافة في «كل التطبيقات»: البلاطة والاسم والوصف والسعر وزر الإضافة إلى الاشتراك.'),
  },
  args: {
    addon: baseAddon,
    canManage: true,
    actionPending: false,
  },
  render: args => ({
    components: { LauncherAddonRow },
    setup: () => ({ args }),
    template: '<div class="max-w-md"><LauncherAddonRow v-bind="args" /></div>',
  }),
} satisfies Meta<typeof LauncherAddonRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'افتراضي (شهري مع سنوي)' }
export const AnnualCadence: Story = {
  name: 'دورة سنوية',
  args: {
    addon: {
      ...baseAddon,
      bundleId: 'bundle-projects-v1',
      appId: 'projects',
      icon: 'i-lucide-folder-kanban',
      labelKey: 'nav.projects',
      descriptionKey: 'launcher.apps.projects.description',
      nameAr: 'المشاريع',
      nameEn: 'Projects',
      primaryPrice: { cadence: { unit: 'year', count: 1 }, amount: sar(240000) },
      secondaryPrice: { cadence: { unit: 'month', count: 1 }, amount: sar(25000) },
    },
  },
}
export const ReadOnly: Story = { name: 'عرض فقط (بلا صلاحية إدارة)', args: { canManage: false } }
export const ActionPending: Story = { name: 'قبل جاهزية الصفحة', args: { actionPending: true } }
