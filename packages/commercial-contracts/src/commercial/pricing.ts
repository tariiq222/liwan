import { CommercialError } from './types.js'

const isNat = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

export function paidExtraBranches(additional: number, included: number): number {
  if (!isNat(additional)) throw new CommercialError('invalid_quantity', 'requested_extra_branches')
  if (!isNat(included)) throw new CommercialError('invalid_quantity', 'included_extra_branches')
  return Math.max(0, additional - included)
}

function toSafe(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new CommercialError('invalid_quantity')
  return Number(v)
}
/** round-half-up(a / b) for non-negative bigint a and positive b. */
const divHalfUp = (a: bigint, b: bigint): bigint => (2n * a + b) / (2n * b)

export function prorateMinor(input: { cycleMinor: number; remainingDays: number; cycleDays: number }): number {
  const { cycleMinor, remainingDays, cycleDays } = input
  if (!isNat(cycleMinor) || !isNat(remainingDays) || !isNat(cycleDays) || cycleDays < 1 || remainingDays > cycleDays)
    throw new CommercialError('invalid_billing_period')
  return toSafe(divHalfUp(BigInt(cycleMinor) * BigInt(remainingDays), BigInt(cycleDays)))
}

export function vat(minor: number, rateBps: number): number {
  if (!isNat(minor) || !isNat(rateBps) || rateBps > 100000) throw new CommercialError('invalid_quantity')
  return toSafe(divHalfUp(BigInt(minor) * BigInt(rateBps), 10000n))
}
