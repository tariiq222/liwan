import { describe, expect, it } from 'vitest'
import { catalogLabel } from '../catalogLabels'

describe('catalog label presentation', () => {
  it('translates known metadata and retains honest unknown labels', () => {
    expect(catalogLabel('module', 'future_module', key => key)).toBe('future_module')
    expect(catalogLabel('module', 'liwan_meetings', key => key)).toBe('vendor.catalog.labels.apps.meetings')
    expect(catalogLabel('module', 'liwan_sales', key => key)).toBe('Sales')
    expect(catalogLabel('module', 'customer_acme_reports', key => key)).toBe('Acme reports')
    expect(catalogLabel('feature', 'boolean:sales.enabled', key => key)).toBe('boolean:sales.enabled')
    expect(catalogLabel('feature', 'boolean:hr.enabled', key => key)).toBe('vendor.catalog.labels.features.hr')
  })
})
