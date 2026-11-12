import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import type { CrmOpportunity } from '@liwan/contracts'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
// The component's own `@/utils/crmErrors` import, resolved the way the sibling component tests do it.
vi.mock('@/utils/crmErrors', () => import('../../../../utils/crmErrors'))
import { crmErrorMessage } from '../../../../utils/crmErrors'
import { contactDraftErrors, contactPatch } from '../CrmOpportunityContactForm.vue'

const record: Pick<CrmOpportunity, 'contact_name' | 'phone' | 'email' | 'source'> = {
  contact_name: 'أحمد العتيبي',
  phone: '+966501234567',
  email: 'ahmad@example.com',
  source: { id: 2, name: 'معرض' },
}
const draft = { contact_name: record.contact_name, phone: record.phone, email: record.email, source_id: 2 }

describe('contactPatch', () => {
  it('sends nothing while the draft still matches the record', () => {
    expect(contactPatch(record, draft)).toEqual({})
  })

  it('sends only the fields the user changed', () => {
    expect(contactPatch(record, { ...draft, phone: '0507654321' })).toEqual({ phone: '0507654321' })
    expect(contactPatch(record, { ...draft, contact_name: 'أحمد', email: '' })).toEqual({ contact_name: 'أحمد', email: '' })
  })

  it('sends an empty email as the empty string and a cleared source as null', () => {
    expect(contactPatch(record, { ...draft, email: '' }).email).toBe('')
    expect(contactPatch(record, { ...draft, source_id: null })).toEqual({ source_id: null })
    expect(contactPatch({ ...record, source: null }, draft)).toEqual({ source_id: 2 })
  })
})

describe('contactDraftErrors', () => {
  it('requires a name and a phone and accepts an empty email', () => {
    expect(contactDraftErrors({ ...draft, contact_name: '  ', phone: '' })).toEqual({ contact_name: 'required', phone: 'required' })
    expect(contactDraftErrors({ ...draft, email: '' })).toEqual({})
  })

  it('refuses an email that is not an address', () => {
    for (const email of ['not-an-email', 'a@', 'a@b', '@example.com']) {
      expect(contactDraftErrors({ ...draft, email }).email, email).toBe('invalid')
    }
    expect(contactDraftErrors({ ...draft, email: 'sara@example.test' })).toEqual({})
  })
})

describe('CrmOpportunityContactForm', () => {
  const filename = resolve(import.meta.dirname, '../CrmOpportunityContactForm.vue')
  // The native select the shared stub leaves as a bare element, so the offered choices are actually rendered.
  const SourceSelect = Vue.defineComponent({
    inheritAttrs: false,
    props: { items: { type: Array, default: () => [] } },
    setup(props, { attrs }) {
      const items = props.items as Array<{ value: number | null, label: string }>
      return () => Vue.h('select', attrs, items.map(item => Vue.h('option', { value: item.value ?? '' }, item.label)))
    },
  })

  async function render(error?: unknown) {
    return renderShared(filename, {
      record: { ...record, source: null, notes: '' },
      sources: [{ id: 1, name: 'الموقع', active: true }, { id: 2, name: 'معرض', active: true }],
      error,
    }, {}, {
      modules: { '@/utils/crmErrors': { crmErrorMessage } },
      stubs: { USelect: SourceSelect },
      messages: {
        'crm.opportunities.form.contact': 'الاسم',
        'crm.opportunities.form.phone': 'الهاتف',
        'crm.opportunities.form.email': 'البريد الإلكتروني',
        'crm.opportunities.form.source': 'المصدر',
        'crm.opportunities.form.sourceNone': 'بلا مصدر',
        'crm.opportunities.contact.title': 'تصحيح بيانات الاتصال',
        'crm.opportunities.contact.submit': 'حفظ بيانات الاتصال',
        'crm.opportunities.errors.duplicatePhone': 'هذا الهاتف مسجل لدى سجل آخر.',
        'app.cancel': 'إلغاء',
      },
    })
  }

  it('draws the four contact fields, the phone and email left-to-right, and the no-source choice', async () => {
    const html = await render()
    expect(html).toContain('data-testid="crm-contact-form"')
    expect(html).toContain('id="contact-edit-name"')
    expect(html).toContain('id="contact-edit-phone"')
    expect(html).toContain('type="tel"')
    expect(html).toContain('id="contact-edit-email"')
    expect(html).toContain('type="email"')
    expect(html).toContain('id="contact-edit-source"')
    expect(html).toContain('بلا مصدر')
    expect(html).toContain('معرض')
  })

  it('shows the server refusal of the phone under its field, in the user words', async () => {
    const html = await render({ status: 422, field: 'phone', details: { reason: 'duplicate_phone' } })
    expect(html).toContain('هذا الهاتف مسجل لدى سجل آخر.')
  })
})
