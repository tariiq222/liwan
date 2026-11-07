import type { PricingPolicy } from '@liwan/commercial-contracts'

/**
 * Which approved pricing policy the form offers and starts on. The control plane lists policies by created_at, then
 * id, and schema_012.sql seeds the VAT row (…0001) and the no-tax row (…0002) in one statement, so they share
 * created_at and VAT sorts first. Nothing here may therefore take the first row: a vendor who is not VAT-registered
 * must never inherit the VAT policy without choosing it.
 */
export function defaultPolicyId(policies: PricingPolicy[]): string | undefined {
  return policies.find(p => p.tax.kind === 'none')?.id
}

/** The approved policies of a `{items, total}` envelope; every one is offered, never only the first. */
export function approvedPolicies(envelope: { items: PricingPolicy[] }): PricingPolicy[] {
  return envelope.items
}

export type PolicyOption = { label: string; value: string }

/** The selector's choices: the no-tax policy first with the no-tax wording, every other policy under the tax it really applies. */
export function policyOptions(policies: PricingPolicy[], taxText: (policy: PricingPolicy) => string): PolicyOption[] {
  const rank = (p: PricingPolicy) => (p.tax.kind === 'none' ? 0 : 1)
  return [...policies].sort((a, b) => rank(a) - rank(b)).map(p => ({ label: taxText(p), value: p.id }))
}
