# e2e — TesterArmy AI Testing Framework

The repository uses [e2e](https://e2e.tester.army/docs) alongside Playwright and Vitest.
Tests live in `e2e/tests/*.e2e.ts`, configuration in `e2e.config.ts`, and model construction in `e2e/models.ts`.
The current script and isolation contracts are documented in [testing.md](testing.md#4-agentic-e2e).

## Run / التشغيل

**English**

- `npm run e2e` runs the suite through `tools/e2e_isolated.mjs` against a private mock API and Nuxt server.
- `npm run e2e:smoke` runs only `e2e/tests/smoke.e2e.ts` through that wrapper.
- `npm run e2e -- --agent fast` selects a configured agent while retaining isolation.
- `npm run e2e:odoo` uses the isolated Odoo stack and the fixed disposable database `webvue_scratch_e2e`.
- Preferred ports are mock `43388`, Nuxt `43300`, and Odoo `43369`; occupied defaults fall back to free ports.
- The wrapper rejects `E2E_BASE_URL` on ports `3000` and `8069`. `npm run e2e:dev` deliberately bypasses the wrapper and uses the direct configuration, which defaults to `http://localhost:3000` and can reuse an existing server.
- Inspect collected tests with `npx e2e list`. The coding-agent skill is in `.agents/skills/e2e/`. `npx e2e mcp` exposes the framework MCP server; the repository ships no `.mcp.json`.

**العربية**

- يشغّل `npm run e2e` الاختبارات عبر `tools/e2e_isolated.mjs` بخادم Nuxt وواجهة API وهمية معزولين.
- يشغّل `npm run e2e:smoke` اختبار الدخان فقط، ويحافظ `npm run e2e -- --agent fast` على العزل عند اختيار الوكيل.
- يستخدم `npm run e2e:odoo` قاعدة الاختبار المؤقتة الثابتة `webvue_scratch_e2e`.
- المنافذ المفضلة هي `43388` للواجهة الوهمية و`43300` لـNuxt و`43369` لـOdoo؛ يختار الغلاف منافذ حرة إن كانت مشغولة.
- يرفض الغلاف توجيه الاختبارات إلى `3000` أو `8069`. الأمر `npm run e2e:dev` يتجاوز الغلاف صراحةً ويستخدم الإعداد المباشر، الذي يبدأ افتراضيًا من `http://localhost:3000` ويمكنه إعادة استخدام خادم قائم.
- استعرض الاختبارات بـ `npx e2e list`، ومهارة وكلاء البرمجة في `.agents/skills/e2e/`.

## Agents / الوكلاء

The table describes `e2e.config.ts`; configuration alone does not establish provider availability.

| Agent | Model or executor | Key source |
| --- | --- | --- |
| `default` | xkiro `moonshotai/kimi-k3-agent`, overridable with `E2E_DEFAULT_MODEL`; Jev judge with xkiro `google/gemini-3.7-flash` fallback | `XKIRO_API_KEY` or DSH credential resolution in `e2e/models.ts`; Jev resolution in `e2e/jev-judge.ts` |
| `ultrafast` | Jev executor (`e2e/jev-ultrafast.ts`) and Jev judge; no text-model executor | Jev resolution in `e2e/jev-judge.ts` |
| `fast` | xkiro `google/gemini-3.7-flash` | Same xkiro resolution as `default` |
| `deepseek` | commandcode `deepseek/deepseek-v4.1-flash` | `COMMANDCODE_API_KEY`, else `~/.commandcode/auth.json` |
| `codex` | ChatGPT subscription `gpt-6.1-sol` | `npx e2e login openai` |

Jev handles supported text judgments; extract and screenshot-only judgments use the configured fallback.
Provider keys are resolved lazily in `e2e/models.ts`; missing provider keys fail when the selected model is called.
No Claude agent is configured in this repository.

## Offline docs

After installation, framework documentation is available in `node_modules/e2e/docs` (`.mdx` pages).
`npx e2e guide <topic>` prints a topic.
