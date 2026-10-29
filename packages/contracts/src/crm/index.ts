import { z } from 'zod'

export * from './call'
export * from './dashboard'
export * from './imports'
export * from './lists'
export * from './notification'
export * from './opportunity'
export * from './settings'

export const CrmCapabilityKeySchema = z.enum([
  'crm.leads.read',
  'crm.leads.work',
  'crm.leads.assign',
  'crm.leads.import',
  'crm.leads.export',
  'crm.discount.approve',
  'crm.settings.read',
  'crm.settings.manage',
  'crm.audit.read',
])

export type CrmCapabilityKey = z.infer<typeof CrmCapabilityKeySchema>
