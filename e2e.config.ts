import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';
import { jevJudge } from './e2e/jev-judge.ts';
import { models } from './e2e/models.ts';

export default {
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        url: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
        // The runner starts `npm run dev` (nuxt dev on :3000), waits until the
        // URL answers, and stops the server when the run ends. An
        // already-running dev server is reused instead.
        command: {
          executable: 'npm',
          args: ['run', 'dev'],
          // The runner passes the child only PATH/HOME/temp vars plus
          // command.env, so forward NUXT_* vars explicitly; unset ones keep
          // the nuxt.config.ts defaults.
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([k, v]) => k.startsWith('NUXT_') && v !== undefined,
            ),
          ) as Record<string, string>,
          // First Nuxt dev compile can exceed the 60s default.
          startupTimeout: 180_000,
          reuseExisting: true,
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  tests: ['e2e/tests/**/*.e2e.ts'],
  // Test-only accounts seeded into the disposable nasq_scratch_e2e database by
  // tools/e2e_seed.py (run by `npm run e2e:odoo`). The defaults mirror that
  // script; E2E_USER_<NAME>_PASSWORD overrides both sides.
  credentials: {
    admin: {
      username: 'e2e_admin',
      password: process.env.E2E_USER_ADMIN_PASSWORD ?? 'nasq-e2e-admin-2026',
    },
    employee: {
      username: 'e2e_employee',
      password: process.env.E2E_USER_EMPLOYEE_PASSWORD ?? 'nasq-e2e-employee-2026',
    },
  },
  // The default agent's model (kimi-k3-agent) is a slow reasoning model:
  // a trivial completion takes ~20s, so agent steps need a wider deadline.
  timeout: 300_000,
  agents: {
    default: {
      // DSH lists `moonshotai/kimi-k3`; the xkiro endpoint serves it as
      // `moonshotai/kimi-k3-agent` (verified via GET /v1/models).
      // Override via E2E_DEFAULT_MODEL (consistency with sawaa).
      model: models.xkiro.chatModel(
        process.env.E2E_DEFAULT_MODEL ?? 'moonshotai/kimi-k3-agent',
      ),
      // Jev (TypeSafe System One) gives the assert/waitFor verdicts from the
      // text observation; extract and screenshot-only judgments fall back to
      // gemini-3.7-flash. Needs JEV_API_KEY or ~/.config/jev-review/api-key.
      judge: jevJudge({ fallback: models.xkiro.chatModel('google/gemini-3.7-flash') }),
    },
    fast: {
      model: models.xkiro.chatModel('google/gemini-3.7-flash'),
    },
    deepseek: {
      model: models.commandcode.chatModel('deepseek/deepseek-v4.1-flash'),
    },
    codex: {
      // ChatGPT subscription model; run `npx e2e login openai` once.
      model: chatgpt('gpt-6.1-sol'),
    },
  },
} satisfies E2EConfig;
