import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * Model construction for the e2e runner.
 *
 * Only the models configured in DeepSeek Harness subagent routing
 * (`subagent-model-selection` in settings.yaml) are used here:
 *
 *  - `default`  : xkiro `moonshotai/kimi-k3` (act) with xkiro `z-ai/glm-5.3` as judge.
 *  - `fast`     : xkiro `z-ai/glm-5.3-flash`.
 *  - `deepseek` : commandcode `deepseek/deepseek-v4.1-flash`.
 *  - `codex`    : ChatGPT subscription `gpt-6.1-sol` (`npx e2e login openai`).
 *
 * Claude (`claude-sonnet-5-5`, configured in DSH via a Claude subscription
 * OAuth login) is deliberately excluded: the e2e framework does not support
 * Claude subscriptions, and we do not keep a separate Anthropic API key.
 */

/** Read the XKIRO_API_KEY from the DSH credentials file without logging it. */
function xkiroKeyFromCredentials(): string | undefined {
  const file = path.join(
    os.homedir(),
    '.local/share/deepseek-harness/home/.credentials.yaml',
  );
  try {
    const text = readFileSync(file, 'utf8');
    let inRefs = false;
    for (const line of text.split('\n')) {
      if (/^refs:/.test(line)) {
        inRefs = true;
        continue;
      }
      if (inRefs) {
        const m = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
        if (m) {
          if (m[1] === 'XKIRO_API_KEY') {
            // `  XKIRO_API_KEY: <value>` inline under `refs:`.
            return m[2].trim().replace(/^['"]|['"]$/g, '') || undefined;
          }
          // Another ref entry starts; keep scanning in case order changes.
        }
      }
    }
  } catch {
    // File missing or unreadable: leave the key unresolved.
  }
  return undefined;
}

/** Read the commandcode API key from ~/.commandcode/auth.json without logging it. */
function commandcodeKeyFromFile(): string | undefined {
  const file = path.join(os.homedir(), '.commandcode/auth.json');
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')).apiKey;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The OpenAI-compatible provider only accepts a static `apiKey` string, so a
 * missing key would have to be known when the config loads. Instead we pass a
 * custom `fetch` that resolves the key per request: agents whose key is
 * absent fail with a clear error only when that agent's model is actually
 * called, and never break config load for the other agents.
 */
function lazyAuthFetch(resolveKey: () => string | undefined, keyName: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = process.env[keyName] ?? resolveKey();
    if (!key) {
      throw new Error(
        `e2e model auth: no API key for ${keyName}. ` +
          `Set the ${keyName} environment variable or configure its stored credentials.`,
      );
    }
    const headers = new Headers(init?.headers);
    if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${key}`);
    }
    return globalThis.fetch(input, { ...init, headers });
  }) as typeof fetch;
}

const xkiro = createOpenAICompatible({
  name: 'xkiro',
  baseURL: 'https://api.xkiro.com/v1',
  fetch: lazyAuthFetch(xkiroKeyFromCredentials, 'XKIRO_API_KEY'),
});

const commandcode = createOpenAICompatible({
  name: 'commandcode',
  baseURL: 'https://api.commandcode.ai/provider/v1',
  fetch: lazyAuthFetch(commandcodeKeyFromFile, 'COMMANDCODE_API_KEY'),
});

export const models = {
  xkiro,
  commandcode,
};
