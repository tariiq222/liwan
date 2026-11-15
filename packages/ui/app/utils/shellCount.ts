/** Largest count a shell badge spells out; anything above shows as `99+`. */
const COUNT_CAP = 99

/** A count draws a badge only when it is a positive number: zero and absent draw nothing. */
export const hasCount = (value: number | null | undefined): value is number => typeof value === 'number' && value > 0

/** The badge text of a count: the number, capped at `99+`. */
export const countLabel = (value: number) => (value > COUNT_CAP ? `${COUNT_CAP}+` : String(value))
