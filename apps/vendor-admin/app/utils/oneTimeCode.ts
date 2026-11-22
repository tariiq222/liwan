import { latinDigits } from './digits'

/** Spaces, no-break spaces and the invisible direction marks a right-to-left paste carries. */
const SEPARATORS = /[\s‎‏‪-‮⁦-⁩]/g

/** A one-time code as the server reads it: Latin digits without the spaces it was grouped or pasted with. Anything else stays, so the server refuses it. */
export const normalizeOneTimeCode = (value: string): string => latinDigits(value).replace(SEPARATORS, '')
