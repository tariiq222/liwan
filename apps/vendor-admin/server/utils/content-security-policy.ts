import { randomBytes } from 'node:crypto'

// The admin console runs with platform-wide authority, so no injected script may run: every script is a
// same-origin file or carries this response's nonce. Nuxt writes its payload, runtime config and colour-mode
// bootstrap as inline <script> tags; they get the nonce instead of a blanket 'unsafe-inline'.
// Styles keep 'unsafe-inline': Nuxt UI sets inline style attributes, and styles cannot run code.

/** A fresh, unguessable nonce for one HTML response. */
export function createNonce(): string {
  return randomBytes(18).toString('base64')
}

/** The document policy for one response, with its nonce. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Adds the nonce to every <script> opening tag of one rendered HTML chunk. Nuxt escapes `<` inside its
 * payload and config scripts, so a match is always a real tag; a hand-written inline script must do the same. */
export function nonceScripts(chunk: string, nonce: string): string {
  return chunk.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`)
}
