import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { APICallError } from 'ai';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  SharedV4Warning,
} from '@ai-sdk/provider';

/**
 * Jev (TypeSafe System One) as the judge of the e2e runner.
 *
 * The runner asks its judge for `{ protocolVersion: "agent-judgment-2",
 * explanation, verdict }` (assert, waitFor). Jev answers a typed choice
 * question with probabilities and no prose, so this adapter maps the runner's
 * instruction and text observation to one `verdict` question and writes the
 * explanation from the choice and its probability. Every other request (an
 * `extract` schema, a judgment that rests on a screenshot alone) goes to the
 * `fallback` model unchanged.
 *
 * Screenshots attached next to a text observation are not sent to Jev.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-preview';

const JUDGMENT_PROTOCOL = 'agent-judgment-2';
export const JEV_KEY_ENV = 'JEV_API_KEY';
export const JEV_KEY_FILE = path.join(os.homedir(), '.config', 'jev-review', 'api-key');
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_OVERLOADED = 529;
const HTTP_SERVER_ERROR_FLOOR = 500;
const ERROR_BODY_MAX_CHARS = 500;
const PROBABILITY_DECIMALS = 2;

const VERDICTS = ['holds', 'fails', 'inconclusive'] as const;
type Verdict = (typeof VERDICTS)[number];

const QUESTION = {
  type: 'choice',
  instructions:
    'Decide whether the instruction is true for the observation right now. ' +
    'The observation is the accessibility tree of the screen under test.',
  criteria: {
    holds: 'The observation shows that the instruction is true.',
    fails: 'The observation shows that the instruction is false.',
    inconclusive:
      'The observation does not contain enough evidence to decide: the relevant part is not on screen, is still loading, or cannot be read.',
  },
} as const;

export type JevJudgeOptions = {
  /** Model for every request that is not a text judgment, e.g. `extract`. */
  fallback: LanguageModelV4;
  /** Resolves the API key per request; defaults to JEV_API_KEY, then the jev-review key file. */
  resolveKey?: () => string | undefined;
  fetch?: typeof fetch;
};

type JevAnswer = { choice: Verdict; probabilities: Record<string, number>; confidence: number };
type JevResult = { answer: JevAnswer; inputTokens: number; outputTokens: number };

export function resolveJevKey(): string | undefined {
  const fromEnv = process.env[JEV_KEY_ENV]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(JEV_KEY_FILE, 'utf8').trim() || undefined;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
}

function isJudgmentRequest(options: LanguageModelV4CallOptions): boolean {
  const format = options.responseFormat;
  if (format?.type !== 'json') return false;
  const protocol = (format.schema?.properties?.protocolVersion ?? {}) as { enum?: unknown[] };
  return protocol.enum?.length === 1 && protocol.enum[0] === JUDGMENT_PROTOCOL;
}

type Evidence = { instruction: string; observation: string; screenshots: number };

/** The instruction and text observation of a judgment prompt, or undefined when it has no text observation. */
function evidenceOf(options: LanguageModelV4CallOptions): Evidence | undefined {
  let text = '';
  let screenshots = 0;
  for (const message of options.prompt) {
    if (message.role !== 'user') continue;
    for (const part of message.content) {
      if (part.type === 'text') text += `${part.text}\n`;
      else screenshots += 1;
    }
  }
  const instruction = /<instruction>\n([\s\S]*?)\n<\/instruction>/.exec(text)?.[1];
  const observation = /<observation [^>]*>\n([\s\S]*?)\n<\/observation>/.exec(text)?.[1];
  if (instruction === undefined || observation === undefined) return undefined;
  return { instruction, observation, screenshots };
}

function explain(answer: JevAnswer): string {
  const probability = answer.probabilities[answer.choice] ?? Number.NaN;
  const digits = (value: number) => value.toFixed(PROBABILITY_DECIMALS);
  return `jev: ${answer.choice} (p=${digits(probability)}, confidence ${digits(answer.confidence)})`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResult(body: unknown): JevResult {
  const verdict = isRecord(body) && isRecord(body.answers) ? body.answers.verdict : undefined;
  const usage = isRecord(body) ? body.usage : undefined;
  if (
    !isRecord(verdict) ||
    !VERDICTS.includes(verdict.choice as Verdict) ||
    !isRecord(verdict.probabilities) ||
    typeof verdict.confidence !== 'number'
  ) {
    throw new Error('Jev returned a response without a verdict choice, probabilities and confidence');
  }
  const tokens = (name: string) => (isRecord(usage) && typeof usage[name] === 'number' ? usage[name] : 0);
  return {
    answer: {
      choice: verdict.choice as Verdict,
      probabilities: verdict.probabilities as Record<string, number>,
      confidence: verdict.confidence,
    },
    inputTokens: tokens('input_tokens'),
    outputTokens: tokens('output_tokens'),
  };
}

async function failure(response: Response, requestBody: unknown): Promise<APICallError> {
  const status = response.status;
  const body = (await response.text()).slice(0, ERROR_BODY_MAX_CHARS);
  return new APICallError({
    message: `Jev ${status}: ${body}`,
    url: JEV_ENDPOINT,
    requestBodyValues: requestBody,
    statusCode: status,
    responseBody: body,
    isRetryable:
      status === HTTP_TOO_MANY_REQUESTS || status === HTTP_OVERLOADED || status >= HTTP_SERVER_ERROR_FLOOR,
  });
}

/** One authenticated POST to the Jev endpoint; a non-2xx answer throws an `APICallError`. */
export async function postJev(
  send: typeof fetch,
  key: string,
  body: unknown,
  abortSignal: AbortSignal | undefined,
): Promise<unknown> {
  const response = await send(JEV_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal,
  });
  if (!response.ok) throw await failure(response, body);
  return response.json();
}

export function jevJudge(options: JevJudgeOptions): LanguageModelV4 {
  const { fallback } = options;
  const resolveKey = options.resolveKey ?? resolveJevKey;
  const send = options.fetch ?? globalThis.fetch;

  async function ask(evidence: Evidence, abortSignal: AbortSignal | undefined): Promise<JevResult> {
    const key = resolveKey();
    if (!key) {
      throw new Error(`e2e Jev judge: no API key. Set ${JEV_KEY_ENV} or write the key to ${JEV_KEY_FILE}.`);
    }
    const body = {
      model: JEV_MODEL,
      state: { instruction: evidence.instruction, observation: evidence.observation },
      questions: { verdict: QUESTION },
    };
    return parseResult(await postJev(send, key, body, abortSignal));
  }

  return {
    specificationVersion: 'v4',
    provider: 'typesafe',
    modelId: `${JEV_MODEL}+${fallback.modelId}`,
    supportedUrls: fallback.supportedUrls,

    async doGenerate(call): Promise<LanguageModelV4GenerateResult> {
      const evidence = isJudgmentRequest(call) ? evidenceOf(call) : undefined;
      if (evidence === undefined) return fallback.doGenerate(call);

      const { answer, inputTokens, outputTokens } = await ask(evidence, call.abortSignal);
      const warnings: SharedV4Warning[] =
        evidence.screenshots === 0
          ? []
          : [{ type: 'unsupported', feature: 'screenshots', details: 'Jev judges the text observation only' }];
      const judgment = { protocolVersion: JUDGMENT_PROTOCOL, explanation: explain(answer), verdict: answer.choice };
      return {
        content: [{ type: 'text', text: JSON.stringify(judgment) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
        },
        providerMetadata: { typesafe: { probabilities: answer.probabilities, confidence: answer.confidence } },
        warnings,
      };
    },

    doStream() {
      throw new Error('e2e Jev judge: streaming is not supported; the runner generates judgments without streaming');
    },
  };
}
