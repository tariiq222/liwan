import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsPage from '@liwan/ui/app/components/shared/layout/SettingsPage.vue'
import SettingsCard from '@liwan/ui/app/components/shared/layout/SettingsCard.vue'
import SettingRow from '@liwan/ui/app/components/shared/layout/SettingRow.vue'
import { storyContext } from '../support/context'

const meta = {
  title: 'Shared/SettingsCard',
  component: SettingsCard,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    ...storyContext('apps/web/app/components/crm/settings/CrmFollowupCard.vue:25', 'بطاقة إعدادات واحدة: حقول بصفوف أفقية، وتذييل فيه «تراجع» و«حفظ التغييرات». من يملك العرض فقط يرى الحقول معطّلة وشارة «عرض فقط».'),
  },
  args: {
    id: 'followup', title: 'المتابعة', description: 'ما يحدث بعد مكالمة بلا نتيجة نهائية.', canEdit: true,
    dirty: false, saving: false, reloading: false, conflict: false, message: '', reloadFailed: false,
  },
  render: args => ({
    components: { SettingsPage, SettingsCard },
    setup: () => ({ args }),
    template: `<main class="liwan-shell-main"><SettingsPage><SettingsCard v-bind="args">
      <UFormField orientation="horizontal" label="محاولات إضافية" description="عدد مرات إعادة الاتصال قبل الإغلاق." name="attempts"><UInputNumber id="attempts" :model-value="2" class="w-full" :disabled="!args.canEdit" /></UFormField>
      <UFormField orientation="horizontal" label="إعادة التدوير" description="تعود الفرصة إلى القائمة بعد مدة."><USwitch :model-value="true" aria-label="إعادة التدوير" :disabled="!args.canEdit" /></UFormField>
    </SettingsCard></SettingsPage></main>`,
  }),
} satisfies Meta<typeof SettingsCard>
export default meta
type Story = StoryObj<typeof meta>
export const Clean: Story = { name: 'بلا تعديل' }
export const FieldGrid: Story = {
  name: 'شبكة حقول وصف قرار',
  render: args => ({
    components: { SettingsPage, SettingsCard, SettingRow },
    setup: () => ({ args }),
    template: `<main class="liwan-shell-main"><SettingsPage><SettingsCard v-bind="args">
      <SettingRow name="logo" label="الشعار" description="PNG أو JPG حتى 2 ميغابايت."><UButton color="neutral" variant="outline" label="اختيار صورة" :disabled="!args.canEdit" /></SettingRow>
      <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
        <UFormField name="city" label="المدينة"><UInput id="city" model-value="الرياض" class="w-full" :disabled="!args.canEdit" /></UFormField>
        <UFormField name="street" label="الشارع"><UInput id="street" model-value="" placeholder="كما يظهر في العنوان الوطني." class="w-full" :disabled="!args.canEdit" /></UFormField>
        <UFormField name="country" label="الدولة"><template #hint><UPopover><UButton type="button" color="neutral" variant="link" size="xs" square icon="i-lucide-circle-help" aria-label="شرح: الدولة" /><template #content><p class="max-w-64 p-3 text-sm">تُحدَّد الدولة عند إنشاء الحساب ولا تتغيّر.</p></template></UPopover></template><UInput id="country" model-value="السعودية" class="w-full" readonly disabled /></UFormField>
        <UFormField name="district" label="الحي"><UInput id="district" model-value="العليا" class="w-full" :disabled="!args.canEdit" /></UFormField>
        <UFormField name="zip" label="الرمز البريدي"><UInput id="zip" model-value="12211" dir="ltr" class="w-full" :disabled="!args.canEdit" /></UFormField>
        <UFormField name="vat_registered" label="مسجّلة في ضريبة القيمة المضافة"><template #hint><UPopover><UButton type="button" color="neutral" variant="link" size="xs" square icon="i-lucide-circle-help" aria-label="شرح: مسجّلة في ضريبة القيمة المضافة" /><template #content><p class="max-w-64 p-3 text-sm">يُطلب الرقم الضريبي وتظهر الضريبة في الفواتير.</p></template></UPopover></template><div class="flex min-h-(--liwan-control-h) items-center"><USwitch :model-value="true" aria-label="مسجّلة في ضريبة القيمة المضافة" :disabled="!args.canEdit" /></div></UFormField>
        <UFormField name="vat" label="الرقم الضريبي"><UInput id="vat" model-value="300000000000003" dir="ltr" class="w-full" :disabled="!args.canEdit" /></UFormField>
      </div>
    </SettingsCard></SettingsPage></main>`,
  }),
}
export const Dirty: Story = { name: 'فيه تعديل', args: { dirty: true } }
export const ReadOnly: Story = { name: 'عرض فقط', args: { canEdit: false } }
export const SaveError: Story = { name: 'تعذّر الحفظ', args: { dirty: true, message: 'تعذّر حفظ الإعدادات الآن' } }
export const Conflict: Story = { name: 'تعارض', args: { dirty: true, conflict: true, message: 'غيّر شخص آخر هذه الإعدادات بعد فتحك الصفحة. حمّل القيم الحالية ثم أعد تعديلك.' } }
