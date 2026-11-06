import type { AiProviderPreset } from '@liwan/commercial-contracts'

/** How the control plane talks to a provider to list its models and to test a key. */
export type Dialect = 'openai' | 'anthropic' | 'ollama'
/** `named`: the AI service's own provider for it knows the endpoint, so no base URL is written to the file (the one above is only where the control plane calls). */
export type Preset = AiProviderPreset & { dialect: Dialect, named: boolean, allowsPrivate: boolean }

/** A hosted, OpenAI-compatible endpoint whose stream is asked for token counts (their docs, checked 2026-11-06, mention stream_options.include_usage for DeepSeek, Groq and Gemini; Together, xAI and Mistral could not be confirmed from their pages and are kept on: the connection test reports a provider that does not return counts). */
const openAiCompatible = (id: string, label: string, base_url: string): Preset =>
  ({ id, label, provider: 'openai_compatible', base_url, needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false, dialect: 'openai', named: false, allowsPrivate: false })

/**
 * The catalog of platform providers the vendor can choose (spec 2026-11-04 §6.13). Every hosted preset except Anthropic,
 * OpenAI and OpenRouter (which have a named provider in the AI service, with their own endpoint and token counts) is the
 * generic `openai_compatible` provider with a fixed endpoint; adding a provider is one entry here and no code path.
 * `stream_usage` is whether the AI service asks that provider's stream for token counts: without them the monthly token
 * limits and the output cap cannot be enforced and cost cannot be reported, so Ollama (which reports them on its own) and
 * a custom endpoint, whose server may refuse the request, are the only ones the catalog does not turn on, and only the
 * custom one lets the vendor tick it. `allowsPrivate` (Ollama only) lets the endpoint be a private or loopback address: every other
 * preset must resolve to a public one, checked where the connection is made.
 */
export const PRESETS: readonly Preset[] = [
  { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false, dialect: 'openai', named: true, allowsPrivate: false },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', base_url: 'https://api.anthropic.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false, dialect: 'anthropic', named: true, allowsPrivate: false },
  openAiCompatible('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  openAiCompatible('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'),
  openAiCompatible('mistral', 'Mistral', 'https://api.mistral.ai/v1'),
  openAiCompatible('groq', 'Groq', 'https://api.groq.com/openai/v1'),
  openAiCompatible('xai', 'xAI', 'https://api.x.ai/v1'),
  openAiCompatible('together', 'Together', 'https://api.together.xyz/v1'),
  { id: 'openrouter', label: 'OpenRouter', provider: 'openrouter', base_url: 'https://openrouter.ai/api/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false, dialect: 'openai', named: true, allowsPrivate: false },
  { id: 'ollama', label: 'Ollama (self-hosted)', provider: 'ollama', base_url: null, needs_base_url: true, needs_api_key: false, stream_usage: false, stream_usage_editable: false, dialect: 'ollama', named: false, allowsPrivate: true },
  { id: 'custom', label: 'OpenAI-compatible (custom)', provider: 'openai_compatible', base_url: null, needs_base_url: true, needs_api_key: true, stream_usage: false, stream_usage_editable: true, dialect: 'openai', named: false, allowsPrivate: false },
]

export const findPreset = (id: string): Preset | undefined => PRESETS.find(preset => preset.id === id)

/** The public shape of a preset (no dialect). */
export const publicPreset = ({ dialect: _dialect, named: _named, allowsPrivate: _allowsPrivate, ...preset }: Preset): AiProviderPreset => preset
