// Text that goes into a log line. A value we did not generate (a provider message, an error message) may carry a line break or another
// control character, which would let it forge a second log line: everything printed from such a value goes through `logText`.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const DEFAULT_MAX = 200

/** The value as one short line: control characters (CR, LF, tab, escape, the Unicode line separators) become spaces, and the text is cut at `max`. */
export function logText(value: unknown, max = DEFAULT_MAX): string {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value ?? '')
  return text.replace(CONTROL_CHARACTERS, ' ').slice(0, max)
}

/** What an error is called in a log: its `code` when it has a string one, else its class name. Never its message. */
export function logCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return logText(typeof code === 'string' && code ? code : (error as Error | null)?.constructor?.name ?? 'error', 40)
}
