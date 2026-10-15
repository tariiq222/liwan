import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DateField from '@nasq/ui/app/components/shared/form/DateField.vue'
import FilterBar from '@nasq/ui/app/components/shared/data/FilterBar.vue'
import FormSection from '@nasq/ui/app/components/shared/layout/FormSection.vue'
import PageContainer from '@nasq/ui/app/components/shared/layout/PageContainer.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/DateField',
  component: DateField,
  parameters: { layout: 'fullscreen' },
  args: { modelValue: null, disabled: false, minValue: null, maxValue: null },
} satisfies Meta<typeof DateField>
export default meta
type Story = StoryObj<typeof meta>

const inForm = (error?: string): Story['render'] => args => ({
  components: { DateField, FormSection, PageContainer },
  setup() {
    const { t } = useI18n()
    return { args, t, value: ref(args.modelValue), error: error ? t(error) : undefined }
  },
  template: `<main class="nasq-shell-main"><PageContainer width="form"><form class="space-y-8"><FormSection :title="t('meetingsUi.sectionSchedule')"><div class="nasq-form-grid"><UFormField :label="t('meetingsUi.date')" name="date" required :error="error"><DateField id="meeting-date" v-model="value" class="w-full" :disabled="args.disabled" :min-value="args.minValue" :max-value="args.maxValue" :aria-invalid="!!error" aria-required="true" /></UFormField></div></FormSection></form></PageContainer></main>`,
})

const formContext = storyContext('apps/web/app/pages/meetings/new.vue:153')

export const InFormField: Story = { name: 'داخل حقل نموذج', parameters: formContext, render: inForm() }
export const WithValue: Story = { name: 'بقيمة', parameters: formContext, args: { modelValue: '2026-09-13' }, render: inForm() }
export const Invalid: Story = { name: 'خطأ تحقق', parameters: formContext, render: inForm('meetingsUx.errors.required') }
export const Disabled: Story = { name: 'معطّل', parameters: formContext, args: { disabled: true }, render: inForm() }

export const InFilterPopover: Story = {
  name: 'داخل نافذة الفلاتر',
  parameters: storyContext('apps/web/app/pages/meetings/index.vue:277', 'نافذة الفلاتر مفتوحة عبر `default-open` في `FilterBar`.'),
  render: () => ({
    components: { DateField, FilterBar, PageContainer },
    setup: () => ({ t: useI18n().t, from: ref<string | null>(null) }),
    template: `<main class="nasq-shell-main"><PageContainer width="list"><FilterBar class="w-full" :default-open="true"><div class="grid min-w-0 content-start gap-1"><label for="meeting-date-from" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.fromDateLabel') }}</label><DateField id="meeting-date-from" v-model="from" class="w-full" /></div></FilterBar></PageContainer></main>`,
  }),
}

export const WithTime: Story = {
  name: 'مع وقت',
  parameters: storyContext('apps/web/app/components/pmo/tasks/TaskProperties.vue:203', 'موعد المهمة: التسمية تعرض التاريخ والوقت، وحقل الوقت في تذييل التقويم يُبقي النافذة مفتوحة بعد اختيار اليوم.'),
  args: { modelValue: '2026-09-20' },
  render: args => ({
    components: { DateField, PageContainer },
    setup: () => ({ t: useI18n().t, value: ref(args.modelValue), time: ref('09:00') }),
    template: `<main class="nasq-shell-main"><PageContainer width="form"><div class="grid max-w-xs gap-1"><span class="text-sm text-muted">{{ t('tasks.drawer.deadline') }}</span><DateField id="task-deadline" v-model="value" :label="value ? value + ' ' + time : undefined" :aria-label="t('tasks.drawer.deadline')"><template #footer><UInput v-model="time" type="time" class="me-auto w-32" :aria-label="t('tasks.drawer.deadlineTime')" /></template></DateField></div></PageContainer></main>`,
  }),
}
