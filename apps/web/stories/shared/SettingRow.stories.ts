import { ref } from 'vue'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '@liwan/ui/app/components/shared/layout/SettingsPage.vue'
import SettingsSection from '@liwan/ui/app/components/shared/layout/SettingsSection.vue'
import SettingRow from '@liwan/ui/app/components/shared/layout/SettingRow.vue'
import OptionCards from '@liwan/ui/app/components/shared/form/OptionCards.vue'
import SegmentedControl from '@liwan/ui/app/components/shared/data/SegmentedControl.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SettingRow',
  component: SettingRow,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/settings/ProjectSettingsForm.vue:171', 'صف إعداد واحد: الاسم والوصف على جهة البداية والعنصر على جهة النهاية؛ مفتاح للقيمة المنطقية، ومقطع لخيارين أو ثلاثة قصيرة، وبطاقات خيارات لما يحتاج شرحًا. يبيّن سبب التعطيل داخل الصف مع رابط للإعداد الذي يعتمد عليه.'),
  },
  args: { label: 'ضبط التغيير', description: 'يحدد هل يحتاج طلب تغيير معتمد لتعديل نطاق المشروع.' },
  render: args => ({
    components: { SettingsPage, SettingsSection, SettingRow, OptionCards, SegmentedControl },
    setup() {
      const mode = ref('optional'); const close = ref('block')
      const options = [
        { value: 'off', label: 'متوقف', description: 'لا طلبات تغيير.' },
        { value: 'optional', label: 'اختياري', description: 'يمكن رفع الطلبات دون منع التعديل.' },
        { value: 'required', label: 'إلزامي', description: 'لا يعدّل النطاق قبل اعتماد الطلب.', disabled: true, disabledReason: 'يتطلب تفعيل أداة الحوكمة.' },
      ]
      const items = [{ value: 'block', label: 'منع الإغلاق' }, { value: 'allow', label: 'السماح مع تحذير' }]
      return { args, mode, close, options, items }
    },
    template: `<main class="liwan-shell-main"><SettingsPage>
      <SettingsSection id="approvals" title="الاعتمادات" description="من يعتمد وماذا قبل الإغلاق.">
        <SettingRow label="إغلاق المشروع وفيه مهام مفتوحة" description="ما يحدث عند نقل المشروع إلى مرحلة الإغلاق."><SegmentedControl v-model="close" :items="items" label="إغلاق المشروع" /></SettingRow>
        <SettingRow v-bind="args" stacked><OptionCards v-model="mode" :options="options" label="ضبط التغيير" /></SettingRow>
        <SettingRow label="خط الأساس" disabled-reason="يتطلب تفعيل أداة التخطيط أولًا." :disabled-link="{ to: '#tools', label: 'أداة التخطيط' }"><USwitch :model-value="false" disabled aria-label="خط الأساس" /></SettingRow>
      </SettingsSection>
    </SettingsPage></main>`,
  }),
} satisfies Meta<typeof SettingRow>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { name: 'صف مع مقطع وبطاقات وإعداد معطّل' }
