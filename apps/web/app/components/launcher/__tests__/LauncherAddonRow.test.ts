import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as commercialUtils from '@liwan/commercial-ui/app/utils/commercial'
import type { AvailableAddonModel } from '@/composables/useAvailableAddons'

const component = resolve(__dirname, '../LauncherAddonRow.vue')
const UButton = Vue.defineComponent({
  inheritAttrs: false,
  props: { to: { type: [String, Object], default: '' }, disabled: Boolean },
  setup: (props, { attrs, slots }) => () => {
    const href = typeof props.to === 'string'
      ? props.to
      : props.to && typeof props.to === 'object'
        ? `${(props.to as { path?: string }).path ?? ''}?add=${(props.to as { query?: { add?: string } }).query?.add ?? ''}`
        : ''
    return Vue.h(href ? 'a' : 'button', { ...attrs, href: href || undefined, disabled: props.disabled || undefined }, slots.default?.())
  },
})

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const addon = (over: Partial<AvailableAddonModel> = {}): AvailableAddonModel => ({
  bundleId: 'bundle-hr-v1',
  appId: 'hr',
  icon: 'i-lucide-users',
  labelKey: 'nav.hr',
  descriptionKey: 'launcher.apps.hr.description',
  nameAr: 'الموارد البشرية',
  nameEn: 'People',
  fallbackDescription: 'وصف احتياطي',
  primaryPrice: { cadence: { unit: 'month', count: 1 }, amount: sar(29900) },
  secondaryPrice: { cadence: { unit: 'year', count: 1 }, amount: sar(299000) },
  ...over,
})

const messages: Record<string, string> = {
  'nav.hr': 'الموارد البشرية',
  'launcher.apps.hr.description': 'شؤون الموظفين والرواتب والإجازات.',
  'launcher.available.addAction': 'إضافة إلى الاشتراك',
  'launcher.available.addShort': 'إضافة',
  'commercial.pricing.cadence.month': 'شهري',
  'commercial.pricing.cadence.year': 'سنوي',
}

const render = (props: Record<string, unknown>, locale = 'ar') => renderShared(component, props, {}, {
  messages,
  stubs: { ...DEFAULT_STUBS, UButton },
  globals: {
    useI18n: () => ({
      t: (key: string) => messages[key] ?? key,
      te: (key: string) => key in messages,
      locale: Vue.ref(locale),
    }),
  },
  modules: {
    '@liwan/commercial-ui/app/utils/commercial': commercialUtils,
  },
})

describe('LauncherAddonRow', () => {
  it('renders identity tile, localized title and description, live prices, and upgrade link for billing managers', async () => {
    const html = await render({ addon: addon(), canManage: true, actionPending: false })
    expect(html).toContain('data-testid="launcher-addon-row"')
    expect(html).toContain('data-app="hr"')
    expect(html).toContain('liwan-app-tile')
    expect(html).toContain('>الموارد البشرية</h3>')
    expect(html).toContain('>شؤون الموظفين والرواتب والإجازات.</p>')
    expect(html).toContain('data-testid="launcher-addon-price"')
    expect(html).toContain('299.00')
    expect(html).toContain('شهري')
    expect(html).toContain('2,990.00')
    expect(html).toContain('سنوي')
    expect(html).toContain('data-testid="launcher-addon-upgrade"')
    expect(html).toContain('href="/subscription/change?add=bundle-hr-v1"')
    expect(html).toContain('aria-label="إضافة إلى الاشتراك: الموارد البشرية"')
    expect(html).toContain('>إضافة</a>')
  })

  it('hides the upgrade button when the caller cannot manage subscriptions', async () => {
    const html = await render({ addon: addon(), canManage: false })
    expect(html).toContain('data-testid="launcher-addon-price"')
    expect(html).not.toContain('data-testid="launcher-addon-upgrade"')
  })

  it('disables the upgrade button before hydration completes', async () => {
    const html = await render({ addon: addon(), canManage: true, actionPending: true })
    expect(html).toMatch(/data-testid="launcher-addon-upgrade"[^>]*disabled|disabled[^>]*data-testid="launcher-addon-upgrade"/)
  })

  it('falls back to catalog names and description when no manifest locale key exists, and omits secondary separator when single cadence', async () => {
    const html = await render({
      addon: addon({ labelKey: null, descriptionKey: null, nameAr: 'حزمة مخصصة', nameEn: 'Custom Suite', secondaryPrice: null }),
      canManage: false,
    }, 'en')
    expect(html).toContain('>Custom Suite</h3>')
    expect(html).toContain('>وصف احتياطي</p>')
    expect(html).not.toContain('2,990.00')
  })
})
