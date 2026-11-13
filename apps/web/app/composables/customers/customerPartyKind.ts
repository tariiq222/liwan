import type { CustomerPartyKinds, CustomFieldValue, CustomFieldWithValue, CustomFieldDefinition } from '@liwan/contracts'

export interface PartyKindForm {
  /** Whether the form offers the person/company choice. */
  canChoose: boolean
  /** The value a new customer has when there is no choice. */
  isCompany: boolean
}

/**
 * What the form offers for the tenant's party kinds, given whether a parent company is chosen. `individuals` offers
 * no company option. `companies` makes a new customer a company, or a contact when a parent is chosen. `both` offers
 * the choice and starts as a person.
 */
export function partyKindForm(kinds: CustomerPartyKinds, parentChosen: boolean): PartyKindForm {
  if (kinds === 'both') return { canChoose: true, isCompany: false }
  return { canChoose: false, isCompany: kinds === 'companies' && !parentChosen }
}

/**
 * Whether the form offers the "belongs to company" picker. A company has no parent. A new customer of a tenant of
 * companies is a company unless a parent is chosen, so the picker is how a contact is made. A tenant of individuals
 * only sees it once company customers exist (or one is already chosen), since the server accepts a contact under a
 * company in every mode.
 */
export function parentPickerOffered(options: { kinds: CustomerPartyKinds; isCompany: boolean; creating: boolean; companiesExist: boolean; parentChosen: boolean }): boolean {
  const { kinds, isCompany, creating, companiesExist, parentChosen } = options
  const contactPossible = !isCompany || (kinds === 'companies' && creating && !parentChosen)
  if (!contactPossible) return false
  return kinds !== 'individuals' || companiesExist || parentChosen
}

/** The empty value of a field of this type: what a customer nobody has filled in yet carries. */
function emptyValue(type: CustomFieldDefinition['type']): CustomFieldValue {
  if (type === 'tags') return []
  if (type === 'boolean') return false
  return null
}

/** The tenant's definition as the fields of a customer that does not exist yet, each empty. */
export function emptyCustomerFields(definition: readonly CustomFieldDefinition[]): CustomFieldWithValue[] {
  return definition.map(field => ({ ...field, value: emptyValue(field.type) }))
}
