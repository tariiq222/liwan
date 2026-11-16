import type { SalesSettings, SalesSettingsPreset, SalesTemplate, SalesTemplateItem } from '@liwan/contracts'
import { salesSettings } from './salesFixtures'

// The wire shapes the template and preset stories share: a ready template, one whose product is archived, and the three
// sector presets as the server sends them.
export const readyTemplate: SalesTemplate = {
  id: 4, name: 'عرض خدمات قياسي', validity_days: 14, archived: false, line_count: 4, usable: true, can_manage: true,
  terms: 'الدفع خلال 14 يومًا من تاريخ التأكيد.',
  lines: [
    { kind: 'section', product: null, name: 'نطاق العمل', quantity: 0, usable: true },
    { kind: 'product', product: { id: 1, name: 'باقة أساسية' }, name: '', quantity: 2, usable: true },
    { kind: 'product', product: { id: 2, name: 'استشارة شهرية' }, name: 'ساعتان أسبوعيًا', quantity: 1, usable: true },
    { kind: 'note', product: null, name: 'يبدأ التنفيذ خلال أسبوع من التأكيد.', quantity: 0, usable: true },
  ],
}
export const brokenTemplate: SalesTemplate = {
  ...readyTemplate, id: 5, name: 'قالب فيه منتج مؤرشف', usable: false,
  lines: readyTemplate.lines.map(line => line.product?.id === 2 ? { ...line, usable: false } : line),
}
export const archivedTemplate: SalesTemplate = { ...readyTemplate, id: 6, name: 'قالب قديم', archived: true }

const item = ({ lines, terms: _terms, ...rest }: SalesTemplate): SalesTemplateItem => ({ ...rest, line_count: lines.length })
export const templateItems: SalesTemplateItem[] = [item(readyTemplate), item(brokenTemplate), { ...item(readyTemplate), id: 7, name: 'عرض بلا مدة', validity_days: 0 }]

export const presets: SalesSettingsPreset[] = [
  { key: 'services', matches: false, values: { visibility: 'own', validity_days: 30, discount_limit_percent: 10, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type' } },
  { key: 'trading', matches: false, values: { visibility: 'all', validity_days: 7, discount_limit_percent: 5, customer_answer: 'accept', acceptance_confirms: true, answered_resend: 'allow', signature_methods: 'draw_or_type' } },
  { key: 'contracting', matches: false, values: { visibility: 'all', validity_days: 60, discount_limit_percent: 3, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'refuse', signature_methods: 'draw' } },
]
/** The presets of a tenant with the payments, CRM and finance bridges: each also sets that bridge's choices. */
export const bridgePresets: SalesSettingsPreset[] = presets.map(preset => ({
  ...preset,
  values: { ...preset.values, payment_to_confirm: preset.key === 'trading' ? 'full' : 'off', opportunity_win: 'order_confirmed', opportunity_win_amount: 'untaxed', invoice_down_payment: preset.key === 'trading' ? 'refuse' : 'allow', invoice_actor: preset.key === 'services' ? 'owner' : 'any_biller' },
}))
export const bridgeSettings: SalesSettings = { ...salesSettings, payment_to_confirm: 'off', prepayment_percent: 50, opportunity_win: 'manual', opportunity_win_amount: 'untaxed', invoice_down_payment: 'allow', invoice_actor: 'owner' }
