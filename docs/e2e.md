# e2e — TesterArmy AI Testing Framework

Setup of the open-source [e2e](https://e2e.tester.army/docs) framework in this repo (additive; the existing Playwright/Vitest suites are untouched). Tests live in `e2e/tests/*.e2e.ts`, config in `e2e.config.ts`, model construction in `e2e/models.ts`.

## Run / التشغيل

**English**

- `npm run e2e` — run the whole suite (`E2E_TELEMETRY_DISABLED=1 e2e run`).
- `npm run e2e:smoke` — run only `e2e/tests/smoke.e2e.ts`.
- Pick an agent with `--agent <name>`: `E2E_TELEMETRY_DISABLED=1 e2e run --agent fast`.
- The config starts `npm run dev` (Nuxt on `http://localhost:3000`) when no server is running and reuses one that is already up; override with `E2E_BASE_URL`.
- Inspect collected tests: `npx e2e list`. Skill for coding agents: `.agents/skills/e2e/` (`.claude/skills/e2e` symlinks to it). MCP server `e2e` is registered in `.mcp.json` (`npx e2e mcp`).

**العربية**

- `npm run e2e` لتشغيل كل الاختبارات، و`npm run e2e:smoke` لاختبار الدخان فقط.
- اختر الوكيل بـ `--agent <name>` مثل: `E2E_TELEMETRY_DISABLED=1 e2e run --agent fast`.
- يبدأ الإعداد خادم التطوير تلقائيًا (Nuxt على `http://localhost:3000`) إن لم يكن يعمل، ويعيد استخدام الجاري تشغيله؛ يمكن تغيير العنوان بمتغيّر `E2E_BASE_URL`.
- استعرض الاختبارات بـ `npx e2e list`، ومهارة وكلاء البرمجة في `.agents/skills/e2e/`.

## Agents / الوكلاء

| Agent | Model | Key source |
| - | - | - |
| `default` | xkiro `moonshotai/kimi-k3` (judge: xkiro `z-ai/glm-5.3`) | `XKIRO_API_KEY` env, else DSH credentials (`E2E_DSH_CREDENTIALS`, `$DSH_HOME/.credentials.yaml`, or fallbacks) → `refs.XKIRO_API_KEY` |
| `fast` | xkiro `z-ai/glm-5.3-flash` | same as `default` |
| `deepseek` | commandcode `deepseek/deepseek-v4.1-flash` | `COMMANDCODE_API_KEY` env, else `~/.commandcode/auth.json` → `apiKey` |
| `codex` | ChatGPT subscription `gpt-6.1-sol` | run `npx e2e login openai` once |

Keys are resolved lazily per model call (custom `fetch` in `e2e/models.ts`): a missing key never breaks config load — it fails with a clear error only when that agent's model is called. Keys are never written or logged.

**Claude limitation / قيد Claude:** `claude-sonnet-5-5` (available in DeepSeek Harness via Claude subscription OAuth) is excluded because **e2e does not support Claude subscriptions** — only API providers. See https://e2e.tester.army/docs/subscriptions.

## Offline docs

The full documentation ships in `node_modules/e2e/docs` after install (`.mdx` pages, e.g. `docs/reference/cli.mdx`), and `npx e2e guide <topic>` prints a topic.
